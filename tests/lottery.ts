import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Commitment, Connection } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import { assert } from "chai";
import { LotteryStatus } from "../app/src/types/lottery";

// Constants for identifying accounts
const myProgramPath = "./target/deploy/lottery-keypair.json"; // Path to the lottery program keypair
const computeUnitPrice = 75_000;
const computeUnitLimitMultiple = 1.3;
const commitment = "confirmed";
const LOTTERY_DURATION_SECONDS = 15; // Controls how long the lottery will run

// Add at the top of the file
interface LotteryState {
  lotteryId: string;
  admin: PublicKey;
  creator: PublicKey;
  entryFee: anchor.BN;
  totalTickets: number;
  participants: PublicKey[];
  endTime: anchor.BN;
  winner: PublicKey | null;
  randomnessAccount: PublicKey | null;
  index: number;
  status: LotteryStatus;
  totalPrize: anchor.BN;
}

// helper functions
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
//function to log balances
async function logBalances(
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

// Utility function to setup the Switchboard queue
async function setupQueue(program: anchor.Program): Promise<PublicKey> {
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

// Utility function to load the Switchboard program
async function loadSbProgram(provider: anchor.Provider): Promise<anchor.Program> {
  console.log("Loading Switchboard program...");
  const sbProgramId = await sb.getProgramId(provider.connection);
  console.log("Switchboard program ID:", sbProgramId.toString());

  console.log("Fetching program IDL...");
  const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);

  if (!sbIdl) {
    console.error("Failed to fetch Switchboard IDL");
    throw new Error("IDL fetch failed");
  }

  console.log("Creating program instance...");
  const sbProgram = new anchor.Program(sbIdl, provider);
  return sbProgram;
}

async function confirmTx(connection: Connection, signature: string) {
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
  keypair: Keypair
): Promise<anchor.web3.TransactionInstruction> {
  return await lotteryProgram.methods
    .selectWinner("lottery_1")
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
  developer: PublicKey
): Promise<anchor.web3.TransactionInstruction> {
  return await lotteryProgram.methods
    .claimPrize("lottery_1")
    .accounts({
      lottery: lotteryAccount,
      player: winner.publicKey,
      creator: creator,
      developer: developer,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// Add helper function to get numeric status
function getNumericStatus(status: any): number {
  if (typeof status === 'number') {
    return status;
  }
  // Handle object case
  if (status.active !== undefined) return 0;
  if (status.endedWaitingForWinner !== undefined) return 1;
  if (status.winnerSelected !== undefined) return 2;
  if (status.completed !== undefined) return 3;
  // If it's a raw number-like value, convert it
  if (status.toString) {
    const num = Number(status.toString());
    if (!isNaN(num)) return num;
  }
  return -1; // Invalid status
}

describe("Lottery", () => {
  it("should setup and initialize lottery", async () => {
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
    // const sbProgram = await loadSbProgram(program!.provider);
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
  });
});

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
      const [lotteryAccount, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from("lottery_1")],
        lotteryProgram.programId
      );
      console.log("Lottery PDA:", lotteryAccount.toString());
      console.log("Lottery bump:", bump);

      // Before initializing the lottery, we should first check if it exists and close it if needed
      try {
        console.log("Checking if lottery account exists...");
        const existingLotteryAccount = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
        if (existingLotteryAccount) {
          console.log("Existing lottery account found, closing it...");
          await lotteryProgram.methods
            .closeLottery("lottery_1")
            .accounts({
              lottery: lotteryAccount,
              admin: keypair.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
          console.log("Existing lottery closed successfully");
        }
      } catch (error) {
        if (error.message.includes("Account does not exist")) {
          console.log("No existing lottery account found");
        } else {
          console.error("Error checking lottery account:", error);
          throw error;
        }
      }

      // Add a delay to ensure the close transaction is confirmed
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Then proceed with initialization
      console.log("Proceeding with initialization...");
      try {
        const entryFee = new anchor.BN(1000000); // 0.001 SOL
        const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + LOTTERY_DURATION_SECONDS);
        console.log(`Setting lottery end time to ${LOTTERY_DURATION_SECONDS} seconds from now`);

        const tx = await lotteryProgram.methods
          .initialize(
            "lottery_1",
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
      console.log("Initial status (raw):", lotteryState.status);
      const numericStatus = getNumericStatus(lotteryState.status);
      console.log("Initial status (numeric):", numericStatus);
      assert.equal(
        numericStatus,
        LotteryStatus.Active,
        "Initial status should be Active"
      );

      // Step 5: Set up multiple ticket purchases
      console.log("\nStep 3: Setting up multiple ticket purchases...");

      // Add delay between ticket purchases
      const buyTicket = async (participant: Keypair) => {
        try {
          console.log(`\nBuying ticket for ${participant.publicKey.toString()}...`);
          const buyTicketIx = await lotteryProgram.methods
            .buyTicket("lottery_1")
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
      console.log(`\nLottery Status:`);
      console.log(`Total tickets purchased: ${lotteryState.totalTickets}`);
      console.log(`Total participants for lottery ID ${lotteryState.lotteryId}: ${lotteryState.participants.length}`);

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
      await sleep(LOTTERY_DURATION_SECONDS * 1000); // Wait 15 seconds
      console.log("Lottery end time reached");

      // Add these checks after waiting for lottery to end
      console.log("\nVerifying lottery status after end time...");
      await sleep(6000); // Wait 6 seconds
      console.log("Lottery end time reached");

      // Update lottery status
      const updateStatusIx = await lotteryProgram.methods
        .updateLotteryStatus("lottery_1")
        .accounts({
          lottery: lotteryAccount,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const updateStatusTx = await sb.asV0Tx({
        connection: sbProgram.provider.connection,
        ixs: [updateStatusIx],
        payer: keypair.publicKey,
        signers: [keypair],
        computeUnitPrice: computeUnitPrice,
        computeUnitLimitMultiple: computeUnitLimitMultiple,
      });

      const updateSig = await connection.sendTransaction(updateStatusTx, txOpts);
      await confirmTx(connection, updateSig);

      // Fetch the latest state after updating status
      lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);

      // Verify status was updated
      console.log("Status after end time:", lotteryState.status);
      assert.equal(
        getNumericStatus(lotteryState.status),
        LotteryStatus.EndedWaitingForWinner,
        "Status should be EndedWaitingForWinner"
      );

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
          keypair
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
          keypair.publicKey   // developer
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
          console.log("Final status:", lotteryState.status);
          assert.equal(
            getNumericStatus(lotteryState.status),
            LotteryStatus.Completed,
            "Final status should be Completed"
          );
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
})