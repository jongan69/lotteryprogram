import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export enum LotteryStatus {
    Active = 0,
    EndedWaitingForWinner = 1,
    WinnerSelected = 2,
    Completed = 3
}

export interface LotteryState {
    lotteryId: string;
    admin: PublicKey;
    creator: PublicKey;
    entryFee: anchor.BN;
    totalTickets: number;
    participants: PublicKey[];
    endTime: anchor.BN;
    winner: PublicKey | null;
    randomnessAccount: PublicKey | null;
    index: number;
    status: LotteryStatus;
    totalPrize: anchor.BN;
  }