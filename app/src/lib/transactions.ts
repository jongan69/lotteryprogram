import { Connection, Keypair } from "@solana/web3.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";

export async function claimPrizeInstruction(
    lotteryProgram: anchor.Program,
    lotteryAccount: PublicKey,
    playerPubkey: PublicKey,
    adminKeypair: Keypair,
    creator: PublicKey,
    lotteryId: string
): Promise<anchor.web3.TransactionInstruction> {
    return await lotteryProgram.methods
        .claimPrize(lotteryId)
        .accounts({
            lottery: lotteryAccount,
            player: playerPubkey,
            creator: creator,
            developer: adminKeypair.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
}   

// Utility to confirm a transaction with retries
export async function confirmTransaction(connection: Connection, signature: string) {
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        if (status?.value?.confirmationStatus === "confirmed") {
            console.log(`Transaction confirmed: ${signature}`);
            return;
        }
        console.log(`Waiting for confirmation (attempt ${attempts + 1}/${maxAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;
    }
    throw new Error(`Transaction not confirmed: ${signature}`);
}

export async function createSelectWinnerInstruction(
    lotteryProgram: anchor.Program,
    lotteryAccount: PublicKey,
    randomnessAccount: PublicKey,
    lotteryId: string
): Promise<anchor.web3.TransactionInstruction> {
    return await lotteryProgram.methods
        .selectWinner(lotteryId)
        .accounts({
            lottery: lotteryAccount,
            randomnessAccountData: randomnessAccount,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
}

// Utility function to setup the Switchboard queue
export async function setupQueue(program: anchor.Program): Promise<PublicKey> {
    const queueAccount = await sb.getDefaultQueue(
        program.provider.connection.rpcEndpoint
    );
    console.log("Queue account found:", queueAccount.pubkey.toString());
    try {
        console.log("Loading queue data...");
        await queueAccount.loadData();
        console.log("Queue data loaded successfully");
    } catch (err) {
        console.error("Error loading queue data:", err);
        console.error("Queue not found, ensure you are using devnet in your env");
        process.exit(1);
    }
    return queueAccount.pubkey;
}