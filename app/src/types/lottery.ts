import { PublicKey } from '@solana/web3.js'
import { BN } from '@coral-xyz/anchor'
import { Program, Idl } from '@coral-xyz/anchor'

export enum LotteryStatus {
  Active = 0,
  EndedWaitingForWinner = 1,
  WinnerSelected = 2,
  Completed = 3
}

export type Lottery = {
  lotteryId: string
  creator: PublicKey
  entryFee: BN
  endTime: BN
  winner: PublicKey | null
  totalTickets: number
  participants: PublicKey[]
  totalPrize: string
  status: {
    statusNumeric: number
    statusDisplay: string
  }
}

export type LotteryListItem = {
  publicKey: PublicKey
  account: Lottery
}

export type PastLottery = {
  publicKey: PublicKey
  account: Lottery
  prizeAmount: number
  winnerAddress: string
}

export type LotteryProgram = Program<Idl> & {
  account: {
    lotteryState: {
      fetch(address: PublicKey): Promise<any>;
      all(): Promise<any[]>;
    };
  };
};
