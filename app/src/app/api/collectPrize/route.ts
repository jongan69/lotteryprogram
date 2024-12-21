import { NextResponse } from "next/server";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL = process.env.RPC_URL!;
const ADMIN_KEY = process.env.ADMIN_KEY!;
const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
const COMMITMENT = "processed";


async function claimPrizeInstruction(
    lotteryProgram: anchor.Program,
    lotteryAccount: PublicKey,
    playerPubkey: PublicKey,
    adminKeypair: Keypair,
    creator: PublicKey,
    lotteryId: string
): Promise<anchor.web3.TransactionInstruction> {
    // First fetch the lottery state to get the creator
    return await lotteryProgram.methods
        .claimPrize(lotteryId)
        .accounts({
            lottery: lotteryAccount,
            player: playerPubkey,
            creator: creator,  // Add creator account
            developer: adminKeypair.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
}

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
        // Load the Anchor and Switchboard programs
        const wallet = {
            publicKey: adminKeypair.publicKey,
            signTransaction: (tx: any) => Promise.resolve(tx.sign([adminKeypair])),
            signAllTransactions: (txs: any[]) => Promise.all(txs.map(tx => tx.sign([adminKeypair]))),
        };
        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: COMMITMENT
        });
        let lotteryProgram: anchor.Program;
        try {
            const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
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
        // Derive Lottery PDA and fetch state
        const [lotteryAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("lottery"), Buffer.from(lotteryId)],
            lotteryProgram.programId
        );
        console.log("Lottery Account:", lotteryAccount.toString());

        // Step 7: Claim prize by the winner
        const playerPubkey = new PublicKey(participant.publicKey);
        const claimPrizeIx = await claimPrizeInstruction(
            lotteryProgram,
            lotteryAccount,
            playerPubkey,
            adminKeypair,
            creator,
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

        // Return the partially signed transaction for the client to complete
        return NextResponse.json({ 
            success: true, 
            transaction: transaction.serialize() 
        });
    } catch (error: any) {
        console.error("Error in collectPrize:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
