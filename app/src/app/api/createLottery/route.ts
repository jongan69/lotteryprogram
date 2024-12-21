import { NextResponse } from 'next/server'
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import * as anchor from "@coral-xyz/anchor"
import bs58 from 'bs58'

// Constants
const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!)
const RPC_ENDPOINT = process.env.RPC_URL!
const ADMIN_PRIVATE_KEY = process.env.ADMIN_KEY! // Make sure this is set in .env.local

export async function POST(request: Request) {
  try {
    // Parse the request body
    const body = await request.json()
    const { name, entryFee, duration } = body

    // Validate inputs
    if (!name || !entryFee || !duration) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Create connection
    const connection = new Connection(RPC_ENDPOINT)

    // Create admin keypair from private key
    const adminKeypair = Keypair.fromSecretKey(
      bs58.decode(ADMIN_PRIVATE_KEY)
    )

    const wallet = {
      publicKey: adminKeypair.publicKey,
      signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => {
        if (tx instanceof anchor.web3.Transaction) {
          tx.partialSign(adminKeypair);
        }
        return tx;
      },
      signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> => {
        txs.forEach(tx => {
          if (tx instanceof anchor.web3.Transaction) {
            tx.partialSign(adminKeypair);
          }
        });
        return txs;
      },
    };

    // Setup Anchor provider
    const provider = new anchor.AnchorProvider(
      connection,
      wallet,
      { commitment: 'confirmed' }
    )
    anchor.setProvider(provider)

    // Get program
    const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
    if (!idl) throw new Error("IDL not found")
    const program = new anchor.Program(idl, provider)

    // Calculate PDA for lottery account
    const [lotteryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("lottery"), Buffer.from(name)],
      PROGRAM_ID
    )

    // Convert entry fee to lamports
    const entryFeeLamports = new anchor.BN(
      entryFee * anchor.web3.LAMPORTS_PER_SOL
    )

    // Calculate end time
    const endTime = new anchor.BN(
      Math.floor(Date.now() / 1000) + parseInt(duration)
    )

    // Create lottery
    const tx = await program.methods
      .initialize(
        name,
        entryFeeLamports,
        endTime,
        adminKeypair.publicKey
      )
      .accounts({
        lottery: lotteryPDA,
        admin: adminKeypair.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    return NextResponse.json({
      success: true,
      signature: tx,
      lotteryAddress: lotteryPDA.toString()
    })

  } catch (error: any) {
    console.error('Failed to create lottery:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create lottery' },
      { status: 500 }
    )
  }
}
  