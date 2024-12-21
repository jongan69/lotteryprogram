import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export interface LotteryState {
    lotteryId: string
    admin: PublicKey
    creator: PublicKey
    entryFee: anchor.BN
    totalTickets: number
    participants: PublicKey[]
    endTime: anchor.BN
    winner: PublicKey | null
    status: number
    totalPrize: anchor.BN
  }

  
//   interface LotteryState {
//     lotteryId: string;
//     status: 'pending' | 'completed' | 'finalized';
//     processing?: boolean;
//     participants?: number;
//     winner?: string;
//     prizeAmount?: number;
//     creator?: string;
//   }

  export interface LotteryListItem {
    publicKey: PublicKey
    account: LotteryState
  }
  
  export interface PastLottery extends LotteryListItem {
    prizeAmount: number;
    winnerAddress: string;
  }

export enum LotteryStatus {
    Active = 0,
    EndedWaitingForWinner = 1,
    WinnerSelected = 2,
    Completed = 3
}


export type LotteryProgram = anchor.Program<anchor.Idl> & {
    account: {
        lotteryState: {
            fetch(address: PublicKey): Promise<any>;
            all(): Promise<any[]>;
        };
    };
};
