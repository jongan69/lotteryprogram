import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Commitment, Connection } from "@solana/web3.js";
import bs58 from "bs58";

interface LotteryParams {
  action: string;
  params: Record<string, any>;
}

// Helper Functions
const validateParams = (action: string, params: Record<string, any>) => {
  const requiredFields: Record<string, string[]> = {
    initializeLottery: ["lotteryId", "entryFee", "endTime"],
    buyTicket: ["lotteryId", "participant"],
    selectWinner: ["lotteryId", "randomnessAccount"],
    claimPrize: ["lotteryId", "participant"],
    getBalances: ["lotteryAccount", "participants"],
  };

  const missingFields = requiredFields[action]?.filter((field) => !(field in params));
  if (missingFields?.length) {
    throw new Error(`Missing required fields for ${action}: ${missingFields.join(", ")}`);
  }
};

const logBalances = async (
  connection: Connection,
  lottery: PublicKey,
  participants: { name: string; pubkey: PublicKey }[]
) => {
  const balances = [];
  for (const participant of participants) {
    const balance = await connection.getBalance(participant.pubkey);
    balances.push({ name: participant.name, balance: balance / anchor.web3.LAMPORTS_PER_SOL });
  }
  return balances;
};

export async function POST(request: Request) {
  try {
    // Parse the request body
    const body: LotteryParams = await request.json();
    const { action, params } = body;

    // Validate action and parameters
    if (!action || !params) {
      throw new Error("Invalid request: Missing action or parameters.");
    }
    validateParams(action, params);

    // Set up admin keypair and connection
    const adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY!));
    const connection = new Connection(process.env.RPC_URL!, "confirmed");
    console.log("Admin public key:", adminKeypair.publicKey.toString());
    console.log("Connected to RPC:", process.env.RPC_URL);

    // Fetch the program
    const provider = new anchor.AnchorProvider(
      connection,
      {
        publicKey: adminKeypair.publicKey,
        signTransaction: async (tx) => tx,
        signAllTransactions: async (txs) => txs,
      } as anchor.Wallet,
      { commitment: "confirmed" }
    );
    const programId = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
    const idl = await anchor.Program.fetchIdl(programId, provider);
    if (!idl) {
      throw new Error("IDL not found for program");
    }
    const program = new anchor.Program(idl, provider);

    // Handle different actions
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

    if (action === "claimPrize") {
      const { lotteryId, participant } = params;
      const [lotteryAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from(lotteryId)],
        program.programId
      );

      const claimTx = await program.methods
        .claimPrize(lotteryId)
        .accounts({
          lottery: lotteryAccount,
          player: new PublicKey(participant.publicKey),
          developer: adminKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return new Response(JSON.stringify({ success: true, transaction: claimTx }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (action === "getBalances") {
      const { lotteryAccount, participants } = params;
      const balances = await logBalances(connection, new PublicKey(lotteryAccount), participants);
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
