import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import bs58 from "bs58";
import { confirmTransaction, setupQueue, createSelectWinnerInstruction } from "@/lib/transactions";
import { PROGRAM_ID, RPC_URL, ADMIN_KEY, COMMITMENT, computeUnitPrice, computeUnitLimitMultiple } from "@/lib/constants";

export const maxDuration = 30;

const txOpts = {
    commitment: COMMITMENT,  // Transaction commitment level
    skipPreflight: true,     // Skip preflight checks
    maxRetries: 0,           // Retry attempts for transaction
};

// API Endpoint
export async function POST(request: Request) {
    try {
        const { action, params } = await request.json();
        if (action !== "selectWinner") {
            return NextResponse.json({ error: "Invalid action" }, { status: 400 });
        }

        const { lotteryId } = params;
        if (!lotteryId) {
            throw new Error("Lottery ID is required");
        }

        // Admin keypair and connection setup
        const adminKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_KEY));
        const connection = new Connection(RPC_URL, COMMITMENT);
        console.log("Admin Public Key:", adminKeypair.publicKey.toString());
        console.log("Connected to RPC:", RPC_URL);

        // Load the Anchor and Switchboard programs
        const wallet = {
            publicKey: adminKeypair.publicKey,
            signTransaction: (tx: any) => Promise.resolve(tx.sign([adminKeypair])),
            signAllTransactions: (txs: any[]) => Promise.all(txs.map(tx => tx.sign([adminKeypair]))),
        };
        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: COMMITMENT
        });
        const idl = await anchor.Program.fetchIdl(PROGRAM_ID!, provider);
        if (!idl) throw new Error("IDL not found for program");
        // Create the program instance correctly
        // console.log("IDL:", idl);
        let lotteryProgram: any;
        try {
            const idl = await anchor.Program.fetchIdl(PROGRAM_ID!, provider);
            if (!idl) {
                throw new Error("IDL not found for program");
            }
            lotteryProgram = new anchor.Program(
                idl,
                provider
            );
        } catch (error) {
            console.error("Error initializing lottery program:", error);
            throw error;
        }
        console.log(lotteryProgram);
        console.log("Lottery Program:", lotteryProgram.programId.toString());
        const sbProgramId = await sb.getProgramId(connection);

        const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
        if (!sbIdl) throw new Error("IDL not found for program");
        const sbProgram = new anchor.Program(sbIdl, provider);
        // console.log("Available account namespaces:", Object.keys(lotteryProgram.account));

        // Derive Lottery PDA and fetch state
        const [lotteryAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("lottery"), Buffer.from(lotteryId)],
            lotteryProgram.programId
        );

        // Fetch lottery state using the correct method
        const lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);

        if (!lotteryState.participants || lotteryState.participants.length === 0) {
            throw new Error("No participants found in the lottery");
        }

        // Create randomness account
        const rngKeypair = Keypair.generate();
        // const programKeypair = Keypair.fromSecretKey(bs58.decode(PROGRAM_KEY));
        let queue = await setupQueue(sbProgram);
        console.log("Queue:", queue.toString());
        const [randomnessAccount, createRandomnessIx] = await sb.Randomness.create(sbProgram, rngKeypair, queue);

        // Create and send randomness initialization transaction
        const createRandomnessTx = await sb.asV0Tx({
            connection: sbProgram.provider.connection,
            ixs: [createRandomnessIx],
            payer: adminKeypair.publicKey,
            signers: [adminKeypair, rngKeypair],
        });
        const randomnessSig = await connection.sendTransaction(createRandomnessTx, txOpts);
        console.log("Randomness Transaction Signature:", randomnessSig);
        await confirmTransaction(connection, randomnessSig);

        // Commit randomness
        const commitIx = await randomnessAccount.commitIx(queue);
        const commitTx = await sb.asV0Tx({
            connection,
            ixs: [commitIx],
            payer: adminKeypair.publicKey,
            signers: [adminKeypair],
            computeUnitPrice,
            computeUnitLimitMultiple,
        });
        const commitSig = await connection.sendTransaction(commitTx, txOpts);
        console.log("Randomness Commit Signature:", commitSig);
        await confirmTransaction(connection, commitSig);

        // Reveal randomness and select winner
        const revealIx = await randomnessAccount.revealIx();
        const selectWinnerIx = await createSelectWinnerInstruction(
            lotteryProgram,
            lotteryAccount,
            randomnessAccount.pubkey,
            lotteryId
        );

        const revealTx = await sb.asV0Tx({
            connection,
            ixs: [revealIx, selectWinnerIx],
            payer: adminKeypair.publicKey,
            signers: [adminKeypair],
            computeUnitPrice,
            computeUnitLimitMultiple,
        });
        const revealSig = await connection.sendTransaction(revealTx, txOpts);
        console.log("Reveal and Select Winner Signature:", revealSig);
        await confirmTransaction(connection, revealSig);

        console.log("Winner selected successfully");
        // console.log("Available accounts:", Object.keys(lotteryProgram.account));
        console.log("Lottery account address:", lotteryAccount.toString());
        return NextResponse.json({ success: true, transaction: revealSig });
    } catch (error: any) {
        console.error("Error in selectWinner:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
