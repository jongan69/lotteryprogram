import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Commitment, Connection } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import { assert } from "chai";

// Import test utils
import { setupQueue } from "../test-utils/setupQueue";
import { myProgramPath, computeUnitPrice, computeUnitLimitMultiple, commitment, LOTTERY_DURATION_SECONDS } from "../test-utils/constants";
import { logBalances } from "../test-utils/logBalance";
import { LotteryState, LotteryStatus } from "../test-utils/types";
import { loadSbProgram } from "../test-utils/loadSbProgram";
import { sleep } from "../test-utils/sleep";
import { getNumericStatus } from "../test-utils/getNumericStatus";
import { confirmTx } from "../test-utils/confirmTx";
import { getStatusString } from "../test-utils/getStringStatus";
import { generateLotteryId } from "../test-utils/generateLotteryId";

// Eventually we should import all the test utils in one go
// import * as testUtils from "../test-utils";

// Utility function to handle sending and confirming transactions
export async function handleTransaction(
  sbProgram: anchor.Program,
  connection: Connection,
  ix: anchor.web3.TransactionInstruction[],
  keypair: Keypair,
  signers: Keypair[],
  txOpts: any
): Promise<string> {
  console.log("Creating transaction...");
  const createTx = await sb.asV0Tx({
    connection: sbProgram.provider.connection,
    ixs: ix,
    payer: keypair.publicKey,
    signers: signers,
    computeUnitPrice: computeUnitPrice,
    computeUnitLimitMultiple: computeUnitLimitMultiple,
  });

  console.log("Simulating transaction...");
  const sim = await connection.simulateTransaction(createTx, txOpts);
  console.log("Simulation result:", sim.value);

  console.log("Sending transaction...");
  const sig = await connection.sendTransaction(createTx, txOpts);
  console.log("Confirming transaction...");
  await confirmTx(connection, sig);
  console.log("Transaction confirmed:", sig);
  return sig;
}

// Create select winner instruction function
async function createSelectWinnerInstruction(
  lotteryProgram: anchor.Program,
  lotteryAccount: PublicKey,
  randomnessAccount: PublicKey,
  keypair: Keypair,
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

// Function to create the instruction for claiming the prize
async function claimPrizeInstruction(
  lotteryProgram: anchor.Program,
  lotteryAccount: PublicKey,
  winner: Keypair,
  creator: PublicKey,
  developer: PublicKey,
  lotteryId: string
): Promise<anchor.web3.TransactionInstruction> {
  return await lotteryProgram.methods
    .claimPrize(lotteryId)
    .accounts({
      lottery: lotteryAccount,
      player: winner.publicKey,
      creator: creator,
      developer: developer,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

describe("Lottery", () => {
  it("Should run through the whole lottery process to completion", async () => {
    try {
      console.log("Starting lottery test script...");

      // Step 1: Load environment settings from Switchboard
      console.log("Loading environment settings...");
      const { keypair, connection, program } = await sb.AnchorUtils.loadEnv();
      console.log("Environment loaded successfully");
      console.log("Program ID:", program!.programId.toString());
      console.log("Wallet pubkey:", keypair.publicKey.toString());

      // Step 2: Setup Switchboard queue for randomness
      console.log("\nSetting up Switchboard queue...");
      let queue = await setupQueue(program!);
      console.log("Queue setup complete");

      console.log("\nLoading programs...");
      // Load Switchboard program
      const sbProgram = await loadSbProgram(program!.provider);
      const myProgramKeypair = await sb.AnchorUtils.initKeypairFromFile(myProgramPath);
      const pid = myProgramKeypair.publicKey;
      console.log("PID:", pid.toString());

      // Add error handling and logging for program loading
      let lotteryProgram: any;
      try {
        const idl = await anchor.Program.fetchIdl(pid, program!.provider);
        if (!idl) {
          throw new Error("IDL not found for program");
        }

        lotteryProgram = new anchor.Program(
          idl,
          program!.provider
        );

        console.log("Lottery program loaded successfully");
        console.log("Available methods:", Object.keys(lotteryProgram.methods));
      } catch (error) {
        console.error("Failed to load lottery program:", error);
        process.exit(1);
      }

      console.log("Programs loaded");
      console.log("Lottery program ID:", lotteryProgram.programId.toString());

      const txOpts = {
        commitment: "processed" as Commitment,  // Transaction commitment level
        skipPreflight: false,                  // Skip preflight checks
        maxRetries: 0,                          // Retry attempts for transaction
      };

      // After loading programs
      console.log("\nStep 1: Creating and funding participants...");
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

      // Then continue with creating randomness account...
      console.log("\nStep 2: Creating randomness account...");
      let randomness: { pubkey: { toString: () => any; }; }, ix: anchor.web3.TransactionInstruction, rngKp: Keypair;
      try {
        rngKp = Keypair.generate();
        console.log("Generated RNG keypair:", rngKp.publicKey.toString());

        [randomness, ix] = await sb.Randomness.create(sbProgram, rngKp, queue);
        console.log("Randomness account created:", randomness.pubkey.toString());

        const createRandomnessTx = await sb.asV0Tx({
          connection: sbProgram.provider.connection,
          ixs: [ix],
          payer: keypair.publicKey,
          signers: [keypair, rngKp],
          computeUnitPrice: computeUnitPrice,
          computeUnitLimitMultiple: computeUnitLimitMultiple,
        });

        console.log("Sending randomness account creation transaction...");
        const sig1 = await connection.sendTransaction(createRandomnessTx, {
          ...txOpts,
          skipPreflight: true  // Add this to help with potential compute budget issues
        });
        await confirmTx(connection, sig1);
        console.log("Randomness account creation confirmed:", sig1);
      } catch (error) {
        console.error("Failed to create randomness account:", error);
        process.exit(1);
      }

      // Step 4: Initialize lottery state accounts
      console.log("\nStep 2: Initializing lottery state accounts...");
      const lotteryId = generateLotteryId("lottery");
      console.log("Generated lottery ID:", lotteryId);

      const [lotteryAccount, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from(lotteryId)],
        lotteryProgram.programId
      );
      console.log("Lottery PDA:", lotteryAccount.toString());
      console.log("Lottery bump:", bump);

      // Then proceed with initialization
      console.log("Proceeding with initialization...");
      try {
        const entryFee = new anchor.BN(1000000); // 0.001 SOL
        const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + LOTTERY_DURATION_SECONDS);
        console.log(`Setting lottery end time to ${LOTTERY_DURATION_SECONDS} seconds from now`);

        const tx = await lotteryProgram.methods
          .initialize(
            lotteryId,
            entryFee,
            endTime,
            keypair.publicKey
          )
          .accounts({
            lottery: lotteryAccount,
            admin: keypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("Lottery initialized successfully. Tx:", tx);
      } catch (error) {
        console.error("Failed to initialize lottery:", error);
        if (error.logs) {
          console.error("Program logs:", error.logs);
        }
        throw error;
      }

      // Add these checks after initializing the lottery
      let lotteryState: LotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
      console.log("\nVerifying initial lottery status...");
      // Verify status was updated
      let status = await lotteryProgram.methods
        .getStatus(lotteryId)
        .accounts({
          lottery: lotteryAccount,
        })
        .view();  // Use .view() since we're just reading data
      console.log("Status after initialization:", status, getNumericStatus(status), getStatusString(status));

      // Step 5: Set up multiple ticket purchases
      console.log("\nStep 3: Setting up multiple ticket purchases...");

      // Add delay between ticket purchases
      const buyTicket = async (participant: Keypair) => {
        try {
          console.log(`\nBuying ticket for ${participant.publicKey.toString()}...`);
          const buyTicketIx = await lotteryProgram.methods
            .buyTicket(lotteryId)
            .accounts({
              lottery: lotteryAccount,
              player: participant.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .instruction();

          const buyTicketTx = await sb.asV0Tx({
            connection: sbProgram.provider.connection,
            ixs: [buyTicketIx],
            payer: participant.publicKey,
            signers: [participant],
            computeUnitPrice: computeUnitPrice,
            computeUnitLimitMultiple: computeUnitLimitMultiple,
          });

          const sig = await connection.sendTransaction(buyTicketTx, txOpts);
          await confirmTx(connection, sig);
          console.log(`Ticket purchased for ${participant.publicKey.toString()}`);
          return true;
        } catch (error) {
          console.error(`Failed to buy ticket for ${participant.publicKey.toString()}:`, error);
          if (error.logs) {
            console.error("Program logs:", error.logs);
          }
          return false;
        }
      };

      // Buy tickets sequentially with error handling
      const participant1Success = await buyTicket(participant1);
      await sleep(2000); // Wait 2 seconds between purchases
      const participant2Success = await buyTicket(participant2);

      // Verify at least one ticket was purchased successfully
      if (!participant1Success && !participant2Success) {
        throw new Error("No tickets were purchased successfully");
      }

      // Log total participants
      lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);

      console.log(`\nLottery Info:`);
      status = await lotteryProgram.methods
        .getStatus(lotteryId)
        .accounts({
          lottery: lotteryAccount,
        })
        .view();  // Use .view() since we're just reading data
      console.log(`Total tickets purchased: ${lotteryState.totalTickets}`);
      console.log(`Total participants for lottery ID ${lotteryState.lotteryId}: ${lotteryState.participants.length}`);
      console.log(`Lottery end time: ${lotteryState.endTime}`);
      console.log(`Lottery status: ${getNumericStatus(status)} (${getStatusString(status)})`);

      // Log balances for all participants
      await logBalances(
        connection,
        lotteryAccount,
        keypair.publicKey,
        [
          { name: "Admin/Creator/Developer", pubkey: keypair.publicKey },
          { name: "Participant 1", pubkey: participant1.publicKey },
          { name: "Participant 2", pubkey: participant2.publicKey }
        ]
      );

      // Before selecting winner, add wait
      console.log("\nWaiting for lottery to end...");
      await sleep(LOTTERY_DURATION_SECONDS * 1000 + 2000); // Add extra 2 seconds buffer
      console.log("Lottery end time reached");

      // Force update the lottery status
      console.log("Updating lottery status...");
      await lotteryProgram.methods
        .getStatus(lotteryId)
        .accounts({
          lottery: lotteryAccount,
        })
        .rpc();

      // Add verification of lottery status
      status = await lotteryProgram.methods
        .getStatus(lotteryId)
        .accounts({
          lottery: lotteryAccount,
        })
        .view();

      console.log("Current lottery status:", status, getNumericStatus(status), getStatusString(status));

      // Proceed with winner selection only if in correct state
      if (getNumericStatus(status) !== LotteryStatus.EndedWaitingForWinner) {
        throw new Error("Lottery not in correct state for winner selection");
      }

      // Step 6: Select a winner using randomness
      console.log("\nStep 4: Selecting winner...");
      try {
        // Create randomness account
        const rngKp = Keypair.generate();
        const [randomness, ix] = await sb.Randomness.create(sbProgram, rngKp, queue);
        console.log("Created randomness account:", randomness.pubkey.toString());

        // Initialize randomness
        const createRandomnessTx = await sb.asV0Tx({
          connection: sbProgram.provider.connection,
          ixs: [ix],
          payer: keypair.publicKey,
          signers: [keypair, rngKp],
        });

        const initSig = await connection.sendTransaction(createRandomnessTx, txOpts);
        await confirmTx(connection, initSig);
        console.log("Randomness initialized. Tx:", initSig);

        // First send commit instruction
        console.log("Committing to randomness...");
        const commitIx = await randomness.commitIx(queue);

        const commitTx = await sb.asV0Tx({
          connection: sbProgram.provider.connection,
          ixs: [commitIx],
          payer: keypair.publicKey,
          signers: [keypair],
          computeUnitPrice: computeUnitPrice,
          computeUnitLimitMultiple: computeUnitLimitMultiple,
        });

        // Simulate first
        await connection.simulateTransaction(commitTx, txOpts);

        // Then send and confirm
        const commitSig = await connection.sendTransaction(commitTx, {
          skipPreflight: true,
          preflightCommitment: txOpts.commitment,
          maxRetries: txOpts.maxRetries,
        });
        const latestBlockHash = await connection.getLatestBlockhash();

        await connection.confirmTransaction({
          signature: commitSig,
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight
        });
        console.log("Randomness committed! Tx:", commitSig);

        // Wait for next slot
        await sleep(2000);

        // Then reveal and select winner in the same transaction
        console.log("Revealing randomness and selecting winner...");
        const revealIx = await randomness.revealIx();
        const selectWinnerIx = await createSelectWinnerInstruction(
          lotteryProgram,
          lotteryAccount,
          randomness.pubkey,
          keypair,
          lotteryId
        );

        const revealTx = await sb.asV0Tx({
          connection: sbProgram.provider.connection,
          ixs: [revealIx, selectWinnerIx],  // Combine reveal and select winner
          payer: keypair.publicKey,
          signers: [keypair],
          computeUnitPrice: computeUnitPrice,
          computeUnitLimitMultiple: computeUnitLimitMultiple,
        });

        const revealSig = await connection.sendTransaction(revealTx, txOpts);
        await confirmTx(connection, revealSig);
        console.log("Randomness revealed! Tx:", revealSig);

        const answer = await connection.getParsedTransaction(revealSig, {
          maxSupportedTransactionVersion: 0,
        });
        console.log("On-chain logs:", answer?.meta?.logMessages);
        let resultLog = answer?.meta?.logMessages?.filter((line) =>
          line.includes("Winner successfully selected:")
        )[0];

        let result = resultLog?.split(": ")[2];
        console.log("Winner:", result);


        // Verify status was updated
        console.log("Checking lottery status...");
        status = await lotteryProgram.methods
          .getStatus(lotteryId)
          .accounts({
            lottery: lotteryAccount,
          })
          .view();  // Use .view() since we're just reading data
        console.log("Status after winner selection:", status, getNumericStatus(status), getStatusString(status));
        assert.equal(
          getNumericStatus(status),
          LotteryStatus.WinnerSelected,
          "Status should be WinnerSelected"
        );

        // After selecting winner
        await logBalances(
          connection,
          lotteryAccount,
          keypair.publicKey,
          [
            { name: "Admin/Creator/Developer", pubkey: keypair.publicKey },
            { name: "Participant 1", pubkey: participant1.publicKey },
            { name: "Participant 2", pubkey: participant2.publicKey }
          ]
        );

        // Add verification of winner selection
        try {
          lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
          if (lotteryState.winner) {
            console.log("Verified winner selected:", lotteryState.winner.toString());
          } else {
            console.log("No winner was selected!");
            process.exit(1);
          }
        } catch (error) {
          console.error("Failed to verify winner selection:", error);
          process.exit(1);
        }

        // After winner selection
        lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
        if (!lotteryState.winner) {
          throw new Error("No winner was selected");
        }

        // Find the winning keypair
        let winningKeypair: Keypair;
        let winningPubkey = new PublicKey(lotteryState.winner.toString());

        if (winningPubkey.equals(keypair.publicKey)) {
          winningKeypair = keypair;
        } else if (winningPubkey.equals(participant1.publicKey)) {
          winningKeypair = participant1;
        } else if (winningPubkey.equals(participant2.publicKey)) {
          winningKeypair = participant2;
        } else {
          throw new Error("Winner not found among participants");
        }

        console.log(`Winner ${winningKeypair.publicKey.toString()} claiming prize...`);

        // Step 7: Claim prize by the winner
        const claimPrizeIx = await claimPrizeInstruction(
          lotteryProgram,
          lotteryAccount,
          winningKeypair,
          keypair.publicKey,  // creator
          keypair.publicKey,  // developer
          lotteryId          // <-- Pass lotteryId
        );

        const claimPrizeTx = await sb.asV0Tx({
          connection: sbProgram.provider.connection,
          ixs: [claimPrizeIx],
          payer: winningKeypair.publicKey,
          signers: [winningKeypair, keypair],  // Include both winner and developer keypairs
          computeUnitPrice: computeUnitPrice,
          computeUnitLimitMultiple: computeUnitLimitMultiple,
        });

        // Add error handling for the claim prize transaction
        try {
          const sig4 = await connection.sendTransaction(claimPrizeTx, txOpts);
          await confirmTx(connection, sig4);
          console.log("Prize claimed successfully! Tx:", sig4);

          // Log final balances
          await logBalances(
            connection,
            lotteryAccount,
            keypair.publicKey,
            [
              { name: "Admin/Creator/Developer", pubkey: keypair.publicKey },
              { name: "Participant 1", pubkey: participant1.publicKey },
              { name: "Participant 2", pubkey: participant2.publicKey }
            ]
          );

          // Fetch latest state after claiming prize
          lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);

          // Add these checks after claiming prize
          console.log("\nVerifying final lottery status...");
          console.log("Final status:", getNumericStatus(lotteryState.status), getStatusString(lotteryState.status));
          assert.isNotNull(lotteryState.winner, "Winner should be preserved after claim");
          assert.equal(lotteryState.winner.toString(), winningKeypair.publicKey.toString(), "Winner should match");
          assert.equal(
            getNumericStatus(lotteryState.status),
            LotteryStatus.Completed,
            "Final status should be Completed"
          );
          console.log("Final lottery state:", lotteryState);
        } catch (error) {
          console.error("Failed to claim prize:", error);
          if (error.logs) {
            console.error("Program logs:", error.logs);
          }
          throw error;
        }
      } catch (error) {
        console.error("Failed to select winner:", error);
      }
    } catch (error) {
      console.error("Main execution failed:");
      console.error("Error:", error);
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
    }
  });
});