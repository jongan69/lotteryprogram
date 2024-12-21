import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

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
