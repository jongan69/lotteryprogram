import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

//function to log balances
export async function logBalances(
    connection: Connection,
    lottery: PublicKey,
    admin: PublicKey,
    participants: { name: string, pubkey: PublicKey }[]
  ) {
    const lotteryBalance = await connection.getBalance(lottery);
    const adminBalance = await connection.getBalance(admin);
  
    console.log("\nCurrent Balances:");
    console.log(`Lottery Pool: ${lotteryBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    console.log(`Admin: ${adminBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  
    // Log each participant's balance
    for (const participant of participants) {
      const balance = await connection.getBalance(participant.pubkey);
      console.log(`Participant #${participants.indexOf(participant)} in Lottery: ${participant.name} balance: ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
    }
  }