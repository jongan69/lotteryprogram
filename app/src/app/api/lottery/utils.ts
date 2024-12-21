import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import * as sb from "@switchboard-xyz/on-demand"
import * as anchor from "@coral-xyz/anchor"

export const PROGRAM_ID = new PublicKey('AxL3SAtyAEDWHopxCwC7FmV7LxzhXgZjpfpVyUvLwRhX')

export type LotteryProgram = anchor.Program<anchor.Idl> & {
  account: {
    lotteryState: {
      fetch(address: PublicKey): Promise<any>;
      all(): Promise<any[]>;
    }
  }
}

export async function handleTransaction(
  connection: Connection,
  ix: anchor.web3.TransactionInstruction[],
  signers: Keypair[],
  payer: PublicKey
) {
  const tx = await sb.asV0Tx({
    connection,
    ixs: ix,
    payer,
    signers,
    computeUnitPrice: 1_000_000,
    computeUnitLimitMultiple: 2.0,
  })

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
  
  const sig = await connection.sendTransaction(tx, {
    skipPreflight: true,
    maxRetries: 3
  })

  await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  }, 'processed')

  return sig
} 