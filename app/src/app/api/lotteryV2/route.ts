import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Commitment, Connection } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import bs58 from "bs58";

// Constants
const commitment: Commitment = "confirmed";
const computeUnitPrice = 75_000;
const computeUnitLimitMultiple = 1.3;

// Helper function to sleep
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to log balances
async function logBalances(
  connection: Connection,
  lottery: PublicKey,
  admin: PublicKey,
  participants: { name: string; pubkey: PublicKey }[]
) {
  const lotteryBalance = await connection.getBalance(lottery);
  const adminBalance = await connection.getBalance(admin);

  console.log("\nCurrent Balances:");
  console.log(`Lottery Pool: ${lotteryBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
  console.log(`Admin: ${adminBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);

  for (const participant of participants) {
    const balance = await connection.getBalance(participant.pubkey);
    console.log(
      `Participant ${participant.name} (${participant.pubkey.toString()}): ${balance / anchor.web3.LAMPORTS_PER_SOL} SOL`
    );
  }
}

// Main API route
export async function POST(request: Request) {
  try {
    console.log("Received API request");
    const body = await request.json();
    const { action, params } = body;

    console.log(`Action: ${action}`);
    console.log(`Params: ${JSON.stringify(params)}`);

    // Load environment variables
    const adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY!));
    const connection = new Connection(process.env.RPC_URL!, commitment);
    console.log("Admin Public Key:", adminKeypair.publicKey.toString());
    console.log("Connected to RPC URL:", process.env.RPC_URL);

    const provider = new anchor.AnchorProvider(
      connection,
      {
        publicKey: adminKeypair.publicKey,
        signTransaction: async (tx) => {
          if ('partialSign' in tx) {
            tx.partialSign(adminKeypair);
          } else {
            tx.sign([adminKeypair]);
          }
          return tx;
        },
        signAllTransactions: async (txs) => {
          txs.forEach((tx) => {
            if ('partialSign' in tx) {
              tx.partialSign(adminKeypair);
            } else {
              tx.sign([adminKeypair]);
            }
          });
          return txs;
        },
      } as anchor.Wallet,
      { commitment }
    );
    anchor.setProvider(provider);

    const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
    const idl = await anchor.Program.fetchIdl(programId, provider);
    if (!idl) throw new Error("IDL not found for program");
    const program = new anchor.Program(idl, provider);
    console.log("Program loaded:", program.programId.toString());

    const txOpts = {
      commitment: "processed" as Commitment,
      skipPreflight: false,
      maxRetries: 0,
    };

    if (action === "initializeLottery") {
      const { lotteryId, entryFee, endTime } = params;
      const [lotteryAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from(lotteryId)],
        program.programId
      );

      await program.methods
        .initialize(
          lotteryId,
          new anchor.BN(entryFee),
          new anchor.BN(endTime)
        )
        .accounts({
          lottery: lotteryAccount,
          admin: adminKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return new Response(
        JSON.stringify({ success: true, lotteryAccount: lotteryAccount.toString() }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (action === "buyTicket") {
      const { lotteryId, participant } = params;
      const [lotteryAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from(lotteryId)],
        program.programId
      );

      const ticketTx = await program.methods
        .buyTicket(lotteryId)
        .accounts({
          lottery: lotteryAccount,
          player: new PublicKey(participant.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return new Response(JSON.stringify({ success: true, transaction: ticketTx }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (action === "selectWinner") {
      const { lotteryId, randomnessAccount } = params;
      const [lotteryAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from(lotteryId)],
        program.programId
      );

      const winnerTx = await program.methods
        .selectWinner(lotteryId)
        .accounts({
          lottery: lotteryAccount,
          randomnessAccountData: new PublicKey(randomnessAccount),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return new Response(JSON.stringify({ success: true, transaction: winnerTx }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (action === "createRandomness") {
      const rngKeypair = Keypair.generate();
      console.log("Generated RNG Keypair:", rngKeypair.publicKey.toString());
      
      const queue = new PublicKey(process.env.NEXT_PUBLIC_QUEUE_ID!);
      const [randomnessAccount, ix] = await sb.Randomness.create(program, rngKeypair, queue, adminKeypair.publicKey);
      console.log("Randomness Account Created:", randomnessAccount.pubkey.toString());

      const randomnessTx = await sb.asV0Tx({
        connection,
        ixs: [ix],
        payer: adminKeypair.publicKey,
        signers: [adminKeypair, rngKeypair],
        computeUnitPrice,
        computeUnitLimitMultiple,
      });

      const sig = await connection.sendTransaction(randomnessTx, txOpts);
      await connection.confirmTransaction(sig);
      console.log("Randomness Transaction Confirmed:", sig);

      return new Response(JSON.stringify({ success: true, randomnessAccount: randomnessAccount.pubkey.toString() }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (action === "getBalances") {
      const { lotteryAccount, participants } = params;
      const balances = await logBalances(connection, new PublicKey(lotteryAccount), adminKeypair.publicKey, participants);

      return new Response(JSON.stringify({ success: true, balances }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in API route:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
