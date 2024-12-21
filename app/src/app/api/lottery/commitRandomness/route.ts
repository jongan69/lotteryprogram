import { Connection } from "@solana/web3.js"
import * as sb from "@switchboard-xyz/on-demand"
import { NextResponse } from 'next/server'
import bs58 from 'bs58'
import { Keypair, PublicKey } from "@solana/web3.js"
import { handleTransaction } from '../utils'
import * as anchor from "@coral-xyz/anchor"

export async function POST(request: Request) {
  try {
    const { lotteryId, randomnessKey, rngKey } = await request.json()
    
    const adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY!))
    const rngKp = Keypair.fromSecretKey(bs58.decode(rngKey))
    const randomnessPubkey = new PublicKey(randomnessKey)
    
    const connection = new Connection(process.env.RPC_URL || 'https://api.devnet.solana.com')
    const { program: sbProgram } = await sb.AnchorUtils.loadEnv()
    const queue = await sb.getDefaultQueue(connection.rpcEndpoint)
    
    // Create randomness object
    const [randomness] = await sb.Randomness.create(sbProgram as anchor.Program<anchor.Idl>, rngKp, queue.pubkey)
    
    // Commit randomness
    const signature = await handleTransaction(
      connection,
      [await randomness.commitIx(queue.pubkey)],
      [adminKeypair, rngKp],
      adminKeypair.publicKey
    )
    
    const revealAndSelectResponse = await fetch('/api/lottery/revealAndSelect', {
      method: 'POST',
      body: JSON.stringify({ lotteryId, randomnessKey: randomness.pubkey.toString(), rngKey: bs58.encode(rngKp.secretKey) })
    })
    const revealAndSelectData = await revealAndSelectResponse.json()
    console.log(revealAndSelectData)
    return NextResponse.json(revealAndSelectData)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
} 