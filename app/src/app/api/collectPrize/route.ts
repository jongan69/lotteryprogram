import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { claimPrizeInstruction } from "@/lib/transactions";
import { LotteryStatus } from "@/types/lottery";
import { PROGRAM_ID, RPC_URL, ADMIN_KEY, COMMITMENT } from '@/lib/constants';   

// API Endpoint
export async function POST(request: Request) {
    try {
        const { action, params } = await request.json();
        if (action !== "collectPrize") {
            return NextResponse.json({ error: "Invalid action" }, { status: 400 });
        }

        const { lotteryId, participant, creator } = params;
        if (!lotteryId || !participant || !creator) {
            throw new Error("Lottery ID, participant, and creator are required");
        }

        // Admin keypair and connection setup
        const adminKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_KEY));
        const connection = new Connection(RPC_URL, COMMITMENT);
        console.log("Admin Public Key:", adminKeypair.publicKey.toString());
        console.log("Connected to RPC:", RPC_URL);

        // Load the Anchor program
        const wallet = {
            publicKey: adminKeypair.publicKey,
            signTransaction: (tx: any) => Promise.resolve(tx.sign([adminKeypair])),
            signAllTransactions: (txs: any[]) => Promise.all(txs.map(tx => tx.sign([adminKeypair]))),
        };
        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: COMMITMENT
        });

        let lotteryProgram: any;
        try {
            const idl = await anchor.Program.fetchIdl(PROGRAM_ID!, provider);
            if (!idl) {
                throw new Error("IDL not found for program");
            }

            lotteryProgram = new anchor.Program(idl, provider);
        } catch (error) {
            console.error("Error initializing lottery program:", error);
            throw error;
        }

        console.log("Lottery Program:", lotteryProgram.programId.toString());

        // Derive Lottery PDA and fetch state
        const [lotteryAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("lottery"), Buffer.from(lotteryId)],
            lotteryProgram.programId
        );
        console.log("Lottery Account:", lotteryAccount.toString());

        // Fetch lottery state to verify status
        const lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
        if (lotteryState.status !== LotteryStatus.WinnerSelected) {
            throw new Error("Prize can only be claimed when winner is selected");
        }

        // Create claim prize instruction
        const playerPubkey = new PublicKey(participant.publicKey);
        const claimPrizeIx = await claimPrizeInstruction(
            lotteryProgram,
            lotteryAccount,
            playerPubkey,
            adminKeypair,
            new PublicKey(creator),
            lotteryId
        );

        // Create the transaction
        const latestBlockhash = await connection.getLatestBlockhash();
        const messageV0 = new anchor.web3.TransactionMessage({
            payerKey: playerPubkey, // Player pays for transaction
            recentBlockhash: latestBlockhash.blockhash,
            instructions: [claimPrizeIx]
        }).compileToV0Message();

        const transaction = new anchor.web3.VersionedTransaction(messageV0);
        transaction.sign([adminKeypair]); // Admin signs first

        // Serialize the transaction to base64
        const serializedTransaction = Buffer.from(
            transaction.serialize()
        ).toString('base64');

        // Return the base64 encoded transaction
        return NextResponse.json({ 
            success: true, 
            transaction: serializedTransaction 
        });
    } catch (error: any) {
        console.error("Error in collectPrize:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
