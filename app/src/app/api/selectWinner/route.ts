import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram, Commitment } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import bs58 from "bs58";

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
const RPC_URL = process.env.RPC_URL!;
const ADMIN_KEY = process.env.ADMIN_KEY!;
const COMMITMENT = "processed";
const computeUnitPrice = 75_000;
const computeUnitLimitMultiple = 1.3;

type LotteryState = {
    lotteryId: string;
    entryFee: number;
    endTime: number;
    totalTickets: number;
    participants: PublicKey[];
    winner: PublicKey | null;
};

// Utility to confirm a transaction with retries
async function confirmTransaction(connection: Connection, signature: string) {
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        if (status?.value?.confirmationStatus === "processed") {
            console.log(`Transaction confirmed: ${signature}`);
            return;
        }
        console.log(`Waiting for confirmation (attempt ${attempts + 1}/${maxAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;
    }
    throw new Error(`Transaction not confirmed: ${signature}`);
}

async function loadSbProgram(provider: anchor.Provider) {
    console.log("Loading Switchboard program...");
    const sbProgramId = await sb.getProgramId(provider.connection);
    console.log("Switchboard program ID:", sbProgramId.toString());

    console.log("Fetching program IDL...");
    const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);

    if (!sbIdl) {
        console.error("Failed to fetch Switchboard IDL");
        throw new Error("IDL fetch failed");
    }
}

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
            commitment: 'confirmed'
        });
        const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
        if (!idl) throw new Error("IDL not found for program");
        // Create the program instance correctly
        const lotteryProgram = new anchor.Program(idl, provider);
        console.log("Lottery Program:", lotteryProgram.programId.toString());
        const sbProgramId = await sb.getProgramId(connection);

        const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
        if (!sbIdl) throw new Error("IDL not found for program");
        const sbProgram = new anchor.Program(sbIdl, provider);

        // Derive Lottery PDA and fetch state
        const [lotteryAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("lottery"), Buffer.from(lotteryId)],
            lotteryProgram.programId
        );

        // Fetch lottery state using the correct method
        const lotteryState = await (lotteryProgram.account as any).lottery.fetch(
            lotteryAccount
        ) as LotteryState;

        if (!lotteryState.participants || lotteryState.participants.length === 0) {
            throw new Error("No participants found in the lottery");
        }

        // Create randomness account
        const rngKeypair = Keypair.generate();
        const queue = await sb.getDefaultQueue(RPC_URL);
        console.log("Queue:", queue.pubkey.toString());
        const [randomnessAccount, createRandomnessIx] = await sb.Randomness.create(sbProgram, rngKeypair, queue.pubkey);

        // Create and send randomness initialization transaction
        const createRandomnessTx = await sb.asV0Tx({
            connection,
            ixs: [createRandomnessIx],
            payer: adminKeypair.publicKey,
            signers: [adminKeypair, rngKeypair],
            computeUnitPrice,
            computeUnitLimitMultiple,
        });
        const randomnessSig = await connection.sendTransaction(createRandomnessTx, {
            skipPreflight: true,
            preflightCommitment: COMMITMENT,
        });
        console.log("Randomness Transaction Signature:", randomnessSig);
        await confirmTransaction(connection, randomnessSig);

        // Commit randomness
        const commitIx = await randomnessAccount.commitIx(queue.pubkey);
        const commitTx = await sb.asV0Tx({
            connection,
            ixs: [commitIx],
            payer: adminKeypair.publicKey,
            signers: [adminKeypair],
            computeUnitPrice,
            computeUnitLimitMultiple,
        });
        const commitSig = await connection.sendTransaction(commitTx, {
            skipPreflight: true,
            preflightCommitment: COMMITMENT,
        });
        console.log("Randomness Commit Signature:", commitSig);
        await confirmTransaction(connection, commitSig);

        // Reveal randomness and select winner
        const revealIx = await randomnessAccount.revealIx();
        const selectWinnerIx = await lotteryProgram.methods
            .selectWinner(lotteryId)
            .accounts({
                lottery: lotteryAccount,
                randomnessAccountData: randomnessAccount,
                systemProgram: SystemProgram.programId,
            })
            .instruction();

        const revealTx = await sb.asV0Tx({
            connection,
            ixs: [revealIx, selectWinnerIx],
            payer: adminKeypair.publicKey,
            signers: [adminKeypair],
            computeUnitPrice,
            computeUnitLimitMultiple,
        });
        const revealSig = await connection.sendTransaction(revealTx, {
            skipPreflight: true,
            preflightCommitment: COMMITMENT,
        });
        console.log("Reveal and Select Winner Signature:", revealSig);
        await confirmTransaction(connection, revealSig);

        console.log("Winner selected successfully");
        return NextResponse.json({ success: true, transaction: revealSig });
    } catch (error: any) {
        console.error("Error in selectWinner:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
