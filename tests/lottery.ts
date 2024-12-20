import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Commitment, Connection } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";

// Constants for identifying accounts
const PLAYER_STATE_SEED = "playerState";  // Unique seed for the player's state account
const myProgramPath = "./target/deploy/lottery-keypair.json"; // Path to the lottery program keypair

(async function main() {
  try {
    console.clear();
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
    let lotteryProgram;
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

    // Step 3: Create randomness account
    console.log("\nStep 1: Creating randomness account...");
    let randomness, ix, rngKp: Keypair;
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
        computeUnitPrice: 75_000,
        computeUnitLimitMultiple: 1.3,
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
    const [lotteryAccount, bump] = await PublicKey.findProgramAddress(
        [Buffer.from("lottery")],  // Make sure this matches LOTTERY_SEED in Rust
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
            // You might want to add a close instruction to your program
            // For now, we'll skip initialization
            console.log("Skipping initialization as lottery already exists");
        }
    } catch (error) {
        // If account doesn't exist, proceed with initialization
        console.log("No existing lottery account found, proceeding with initialization...");
        const entryFee = new anchor.BN(1000000); // 0.001 SOL
        const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now
        
        const tx = await lotteryProgram.methods
            .initialize(entryFee, endTime)
            .accounts({
                lottery: lotteryAccount,
                admin: keypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
            
        console.log("Lottery initialized successfully. Tx:", tx);
    }

    // Add this before initialization attempt
    try {
        console.log("Attempting to close existing lottery...");
        await lotteryProgram.methods
            .closeLottery()
            .accounts({
                lottery: lotteryAccount,
                admin: keypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        console.log("Existing lottery closed successfully");
    } catch (error) {
        console.log("No existing lottery to close or close failed");
    }

    // Then proceed with initialization

    // Step 5: Simulate user buying a ticket and purchase a ticket
    console.log("\nStep 3: Setting up ticket purchase...");
    const [playerStateAccount, playerStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from(PLAYER_STATE_SEED), keypair.publicKey.toBuffer()],
      lotteryProgram.programId
    );
    console.log("Player state PDA:", playerStateAccount.toString());
    console.log("Player state bump:", playerStateBump);

    const buyTicketIx = await createLotteryInstruction(
      lotteryProgram,
      lotteryAccount,
      playerStateAccount,
      rngKp.publicKey,
      keypair
    );

    const buyTicketTx = await sb.asV0Tx({
      connection: sbProgram.provider.connection,
      ixs: [buyTicketIx],
      payer: keypair.publicKey,
      signers: [keypair],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    const sig2 = await connection.sendTransaction(buyTicketTx, txOpts);
    await confirmTx(connection, sig2);
    console.log("  Transaction Signature for buying ticket: ", sig2);

    // Step 6: Select a winner using randomness
    console.log("\nStep 4: Selecting winner...");
    const selectWinnerIx = await createSelectWinnerInstruction(
      lotteryProgram,
      lotteryAccount,
      randomness.pubkey, // Use the Switchboard randomness account
      keypair
    );

    const selectWinnerTx = await sb.asV0Tx({
      connection: sbProgram.provider.connection,
      ixs: [selectWinnerIx],
      payer: keypair.publicKey,
      signers: [keypair],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    console.log("Sending select winner transaction...");
    const sig3 = await connection.sendTransaction(selectWinnerTx, txOpts);
    await confirmTx(connection, sig3);
    console.log("Winner selection confirmed:", sig3);

    // Add verification of winner selection
    try {
      const lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
      if (lotteryState.winner) {
        console.log("Winner selected:", lotteryState.winner.toString());
      } else {
        console.log("No winner was selected!");
        process.exit(1);
      }
    } catch (error) {
      console.error("Failed to verify winner selection:", error);
      process.exit(1);
    }

    // Step 7: Claim prize by the winner
    const claimPrizeIx = await claimPrizeInstruction(
      lotteryProgram,
      lotteryAccount,
      playerStateAccount,
      keypair
    );

    const claimPrizeTx = await sb.asV0Tx({
      connection: sbProgram.provider.connection,
      ixs: [claimPrizeIx],
      payer: keypair.publicKey,
      signers: [keypair],
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    const sig4 = await connection.sendTransaction(claimPrizeTx, txOpts);
    await confirmTx(connection, sig4);
    console.log("  Transaction Signature for claiming prize: ", sig4);

    // Function to create PDA for a lottery
    async function getLotteryAddress(programId: PublicKey, lotteryId: string): Promise<[PublicKey, number]> {
        return await PublicKey.findProgramAddress(
            [
                Buffer.from("lottery"),
                Buffer.from(lotteryId),
            ],
            programId
        );
    }

    // In your test code, create multiple lotteries
    const lottery1Id = "lottery_1";
    const lottery2Id = "lottery_2";

    // Get PDAs for both lotteries
    const [lottery1Account, bump1] = await getLotteryAddress(lotteryProgram.programId, lottery1Id);
    const [lottery2Account, bump2] = await getLotteryAddress(lotteryProgram.programId, lottery2Id);

    // Initialize first lottery
    const tx1 = await lotteryProgram.methods
        .initialize(
            lottery1Id,
            new anchor.BN(1000000), // entry fee
            new anchor.BN(Math.floor(Date.now() / 1000) + 3600)
        )
        .accounts({
            lottery: lottery1Account,
            admin: keypair.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    console.log("Lottery 1 initialized:", tx1);

    // Initialize second lottery
    const tx2 = await lotteryProgram.methods
        .initialize(
            lottery2Id,
            new anchor.BN(2000000), // different entry fee
            new anchor.BN(Math.floor(Date.now() / 1000) + 7200) // different end time
        )
        .accounts({
            lottery: lottery2Account,
            admin: keypair.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .rpc();

    console.log("Lottery 2 initialized:", tx2);

    // Buy tickets for specific lottery
    const buyTicketForLottery = async (lotteryId: string, lotteryAccount: PublicKey) => {
        await lotteryProgram.methods
            .buyTicket(lotteryId)
            .accounts({
                lottery: lotteryAccount,
                player: keypair.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
    };

    // Example usage
    await buyTicketForLottery(lottery1Id, lottery1Account);
    await buyTicketForLottery(lottery2Id, lottery2Account);
  } catch (error) {
    console.error("Main execution failed:");
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
    process.exit(1);
  }
})();

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

// Function to initialize the lottery
async function initializeLottery(
  lotteryProgram: anchor.Program,
  lotteryAccount: PublicKey,
  keypair: Keypair,
  sbProgram: anchor.Program,
  connection: Connection
): Promise<void> {
  console.log("Creating initialize instruction...");
  
  // Add these parameters that are required by your Rust program
  const entryFee = new anchor.BN(1000000); // 0.001 SOL
  const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now
  
  const initIx = await lotteryProgram.methods
    .initialize(entryFee, endTime)  // Add the required parameters
    .accounts({
      lottery: lotteryAccount,      // Changed from 'lotteryAccount' to 'lottery'
      admin: keypair.publicKey,     // Changed from 'user' to 'admin'
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  console.log("Initialize instruction created");

  // Sending the transaction to initialize the lottery
  console.log("Sending initialize transaction...");
  const txOpts = {
    commitment: "processed" as Commitment,
    skipPreflight: true,
    maxRetries: 0,
  };

  await handleTransaction(sbProgram, connection, [initIx], keypair, [keypair], txOpts);
  console.log("Initialize transaction completed");
}
// Function to create the instruction for buying a lottery ticket
async function createLotteryInstruction(
  lotteryProgram: anchor.Program,
  lotteryAccount: PublicKey,
  playerStateAccount: PublicKey,
  randomnessAccount: PublicKey,
  keypair: Keypair
): Promise<anchor.web3.TransactionInstruction> {
  return await lotteryProgram.methods
    .buyTicket()
    .accounts({
      lottery: lotteryAccount,
      playerState: playerStateAccount,
      randomnessAccount: randomnessAccount,
      user: keypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// Function to create the instruction for claiming the prize
async function claimPrizeInstruction(
  lotteryProgram: anchor.Program,
  lotteryAccount: PublicKey,
  playerStateAccount: PublicKey,
  keypair: Keypair
): Promise<anchor.web3.TransactionInstruction> {
  return await lotteryProgram.methods
    .claimPrize()
    .accounts({
      lottery: lotteryAccount,      // Changed from lotteryAccount to lottery
      playerState: playerStateAccount,
      user: keypair.publicKey,
      developer: keypair.publicKey,  // Added missing developer account
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

// Add this new function for selecting winners
async function createSelectWinnerInstruction(
  lotteryProgram: anchor.Program,
  lotteryAccount: PublicKey,
  randomnessAccount: PublicKey,
  keypair: Keypair
): Promise<anchor.web3.TransactionInstruction> {
  return await lotteryProgram.methods
    .selectWinner()
    .accounts({
      lottery: lotteryAccount,
      randomnessAccountData: randomnessAccount,  // This matches your Rust program
      user: keypair.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
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
    computeUnitPrice: 75_000,
    computeUnitLimitMultiple: 1.3,
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

async function confirmTx(connection: Connection, signature: string) {
  try {
    const latestBlockhash = await connection.getLatestBlockhash();
    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    }, 'confirmed');  // Change commitment level to 'confirmed'

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err.toString()}`);
    }

    return confirmation;
  } catch (error) {
    console.error("Transaction confirmation failed:", error);
    throw error;
  }
}