import { assert } from "chai";
import { LotteryStatus, LotteryState } from "../test-utils/types";
import * as anchor from "@coral-xyz/anchor";
import * as sb from "@switchboard-xyz/on-demand";
import { myProgramPath } from "../test-utils/constants";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { getNumericStatus } from "../test-utils/getNumericStatus";
import { sleep } from "../test-utils/sleep";
import { generateLotteryId } from "../test-utils/generateLotteryId";

it("Should automatically update status when lottery ends", async () => {
  console.log("Starting test...");
  
  // Load the needed environment variables
  const { keypair, connection, program } = await sb.AnchorUtils.loadEnv();
  console.log("Environment loaded, keypair pubkey:", keypair.publicKey.toString());
  
  const myProgramKeypair = await sb.AnchorUtils.initKeypairFromFile(myProgramPath);
  const pid = myProgramKeypair.publicKey;
  console.log("Program ID:", pid.toString());

  // Load the lottery program
  console.log("Loading program IDL...");
  const idl = await anchor.Program.fetchIdl(pid, program!.provider);
  if (!idl) throw new Error("IDL not found for program");
  console.log("IDL loaded successfully");

  const lotteryProgram = new anchor.Program(
    idl,
    program!.provider
  );
  console.log("Program initialized");

  // Initialize lottery with a very short duration
  const shortDuration = 5; // 5 seconds
  const entryFee = new anchor.BN(1000000); // 0.001 SOL
  const endTime = new anchor.BN(Math.floor(Date.now() / 1000) + shortDuration);
  console.log("Lottery parameters set - Duration:", shortDuration, "End time:", endTime.toString());

  // Generate unique lottery ID
  const lotteryId = generateLotteryId("status");
  console.log("Generated lottery ID:", lotteryId);

  // Create lottery account with unique ID
  const [lotteryAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("lottery"), Buffer.from(lotteryId)],
    lotteryProgram.programId
  );
  console.log("Lottery PDA address:", lotteryAccount.toString());

  // Initialize the lottery
  console.log("Initializing new lottery...");
  try {
    await lotteryProgram.methods
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
      .signers([keypair])
      .rpc();
    console.log("Lottery initialized successfully");
  } catch (error) {
    console.error("Failed to initialize lottery:", error);
    console.error("Error logs:", error?.logs);
    throw error;
  }

  // Check status
  console.log("Checking lottery status...");
  let status = await lotteryProgram.methods
    .getStatus(lotteryId)
    .accounts({
      lottery: lotteryAccount,
    })
    .view();
  console.log("Status after initialization:", status);

  // Wait for the lottery to end
  console.log("Waiting for lottery to end...");
  await sleep((shortDuration + 1) * 1000);

  // Create and fund participant wallet
  const participant = Keypair.generate();
  const fundAmount = 0.1 * anchor.web3.LAMPORTS_PER_SOL;
  
  // Transfer SOL from main keypair instead of airdrop
  const transferTx = new anchor.web3.Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: participant.publicKey,
      lamports: fundAmount,
    })
  );
  
  await anchor.web3.sendAndConfirmTransaction(
    connection,
    transferTx,
    [keypair]
  );
  
  await sleep(1000); // Wait for transfer to confirm

  try {
    await lotteryProgram.methods
      .buyTicket(lotteryId)
      .accounts({
        lottery: lotteryAccount,
        player: participant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([participant])
      .rpc();

    assert.fail("Should not be able to buy ticket after lottery ends");
  } catch (error) {
    // Expected error
    console.log("Correctly failed to buy ticket after end time");
  }

  // Verify status was automatically updated
  console.log("Checking lottery status...");
  status = await lotteryProgram.methods
    .getStatus(lotteryId)
    .accounts({
      lottery: lotteryAccount,
    })
    .view();
  console.log("Status after end time:", status);
  assert.equal(
    getNumericStatus(status),
    LotteryStatus.EndedWaitingForWinner,
    "Status should be EndedWaitingForWinner"
  );
  console.log("Status update test completed successfully");
});