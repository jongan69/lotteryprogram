import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { LotteryProgram } from "@/types/lottery";
import { WalletContextState } from "@solana/wallet-adapter-react";

// Update the getProgram function to accept an optional wallet parameter
export const getProgram = async (connection: Connection, wallet: WalletContextState | null, PROGRAM_ID: PublicKey): Promise<LotteryProgram> => {
    if (!PROGRAM_ID) throw new Error("Program ID not initialized")
  
    // Create a provider with or without wallet
    const provider = wallet?.publicKey
      ? new anchor.AnchorProvider(
        connection,
        {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction!,
          signAllTransactions: wallet.signAllTransactions!,
        } as anchor.Wallet,
        { commitment: 'confirmed' }
      )
      : new anchor.AnchorProvider(
        connection,
        // Provide a dummy wallet when none is connected
        {
          publicKey: PublicKey.default,
          signTransaction: async (tx) => tx,
          signAllTransactions: async (txs) => txs,
        } as anchor.Wallet,
        { commitment: 'confirmed' }
      );
  
    anchor.setProvider(provider)
  
    // Fetch IDL from chain
    const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
    if (!idl) throw new Error("IDL not found")
    return new anchor.Program(idl, provider) as LotteryProgram
  }