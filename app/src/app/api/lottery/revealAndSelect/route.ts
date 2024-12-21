import { Connection } from "@solana/web3.js"
import bs58 from 'bs58'
import * as sb from "@switchboard-xyz/on-demand"
import { NextResponse } from 'next/server'
import { Keypair, PublicKey } from "@solana/web3.js"
import * as anchor from "@coral-xyz/anchor"
import { handleTransaction, PROGRAM_ID } from '../utils'

interface LotteryState {
  lotteryId: string;
  entryFee: number;
  endTime: number;
  totalTickets: number;
  participants: PublicKey[];
  winner: PublicKey | null;
}

type LotteryProgram = anchor.Program<anchor.Idl> & {
  account: {
    lotteryState: {
      fetch(address: PublicKey): Promise<LotteryState>;
    }
  }
}

export async function POST(request: Request) {
  try {
    const { lotteryId, randomnessKey, rngKey, randomness } = await request.json()
    
    const adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY!))
    const rngKp = Keypair.fromSecretKey(bs58.decode(rngKey))
    const randomnessPubkey = new PublicKey(randomnessKey)
    
    const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com')
    const { program: sbProgram } = await sb.AnchorUtils.loadEnv()
    if (!sbProgram) throw new Error("Failed to load Switchboard program")
    
    // Load programs
    const idl = await anchor.Program.fetchIdl(PROGRAM_ID, sbProgram.provider)
    if (!idl) throw new Error("IDL not found")
    const program = new anchor.Program(idl, sbProgram.provider) as LotteryProgram
    
    // Get lottery PDA
    const [lotteryAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("lottery"), Buffer.from(lotteryId)],
      program.programId
    )
    
    // Reveal and select winner
    const signature = await handleTransaction(
      connection,
      [
        await randomness.revealIx(),
        await program.methods
          .selectWinner(lotteryId)
          .accounts({
            lottery: lotteryAccount,
            randomnessAccountData: randomnessPubkey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .instruction()
      ],
      [adminKeypair, rngKp],
      adminKeypair.publicKey
    )
    
    const updatedState = await program.account.lotteryState.fetch(lotteryAccount) as LotteryState
    
    return NextResponse.json({
      success: true,
      signature,
      winner: updatedState.winner?.toString()
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
} 