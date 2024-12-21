import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

export enum LotteryStatus {
    Active = 0,
    EndedWaitingForWinner = 1,
    WinnerSelected = 2,
    Completed = 3
}

export interface Lottery {
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

export interface LotteryListItem {
    publicKey: PublicKey
    account: Lottery
}

export interface PastLottery extends LotteryListItem {
    prizeAmount: number;
    winnerAddress: string;
}

export type LotteryProgram = anchor.Program<anchor.Idl> & {
    account: {
        lotteryState: {
            fetch(address: PublicKey): Promise<any>;
            all(): Promise<any[]>;
        };
    };
};
