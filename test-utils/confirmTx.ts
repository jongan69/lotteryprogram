import { Connection } from "@solana/web3.js";
import { commitment } from "./constants";

// Utility function to handle sending and confirming transactions
export async function confirmTx(connection: Connection, signature: string) {
    try {
      const latestBlockhash = await connection.getLatestBlockhash();
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, commitment);  // Change commitment level to 'confirmed'
  
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
      }
  
      return confirmation;
    } catch (error) {
      console.error("Transaction confirmation failed:", error);
      throw error;
    }
  }