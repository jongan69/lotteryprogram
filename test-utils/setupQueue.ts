import { PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";

// Utility function to setup the Switchboard queue
export async function setupQueue(program: Program): Promise<PublicKey> {
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