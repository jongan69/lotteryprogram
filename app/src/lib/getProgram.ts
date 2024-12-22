import { Connection, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { LotteryProgram } from "@/types/lottery";
import { WalletContextState } from "@solana/wallet-adapter-react";
import IDL from "../idl/lottery.json";  // Change to default import

export const getProgram = async (connection: Connection, wallet: any | null, PROGRAM_ID: PublicKey): Promise<LotteryProgram> => {
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
    
    return new anchor.Program(IDL as anchor.Idl, provider) as LotteryProgram;
}