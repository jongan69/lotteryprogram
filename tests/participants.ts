import * as sb from "@switchboard-xyz/on-demand";
import * as anchor from "@coral-xyz/anchor";
import { SystemProgram, Keypair, Commitment } from "@solana/web3.js";
import { loadSbProgram } from "../test-utils/loadSbProgram";
import { confirmTx } from "../test-utils/confirmTx";
import { computeUnitPrice, computeUnitLimitMultiple } from "../test-utils/constants";

describe("Lottery", () => {
    it("Create and fund participants from admin wallet", async () => {
      const { keypair, connection, program } = await sb.AnchorUtils.loadEnv();
      const sbProgram = await loadSbProgram(program!.provider);
      const txOpts = {
        commitment: "processed" as Commitment,  // Transaction commitment level
        skipPreflight: false,                  // Skip preflight checks
        maxRetries: 0,                          // Retry attempts for transaction
      };
  
      const participant1 = Keypair.generate();
      const participant2 = Keypair.generate();
      console.log("Created participants:", {
        participant1: participant1.publicKey.toString(),
        participant2: participant2.publicKey.toString()
      });
  
      // Fund the participants first
      console.log("Funding participants...");
      const fundAmount = 0.2 * anchor.web3.LAMPORTS_PER_SOL;
  
      const transferIx1 = SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: participant1.publicKey,
        lamports: fundAmount,
      });
  
      const transferIx2 = SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: participant2.publicKey,
        lamports: fundAmount,
      });
  
      const fundTx1 = await sb.asV0Tx({
        connection: sbProgram.provider.connection,
        ixs: [transferIx1],
        payer: keypair.publicKey,
        signers: [keypair],
        computeUnitPrice: computeUnitPrice,
        computeUnitLimitMultiple: computeUnitLimitMultiple,
      });
  
      const fundTx2 = await sb.asV0Tx({
        connection: sbProgram.provider.connection,
        ixs: [transferIx2],
        payer: keypair.publicKey,
        signers: [keypair],
        computeUnitPrice: computeUnitPrice,
        computeUnitLimitMultiple: computeUnitLimitMultiple,
      });
  
      const fundSig1 = await connection.sendTransaction(fundTx1, txOpts);
      await confirmTx(connection, fundSig1);
      const fundSig2 = await connection.sendTransaction(fundTx2, txOpts);
      await confirmTx(connection, fundSig2);
      console.log("Participants funded successfully");
    });
  });