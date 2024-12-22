import * as sb from "@switchboard-xyz/on-demand";
import { setupQueue } from "../test-utils/setupQueue";
import { myProgramPath } from "../test-utils/constants";
import * as anchor from "@coral-xyz/anchor";


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