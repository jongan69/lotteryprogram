import * as anchor from '@coral-xyz/anchor';
import { PROGRAM_ID } from './constants';
import { getNumericStatus, getStatusString } from './utils';
import { PublicKey } from '@solana/web3.js';

export async function getStatus(lotteryId: string, provider: anchor.AnchorProvider) {
    // console.log('Lottery ID:', lotteryId);
    // console.log('Program ID:', PROGRAM_ID);
    const idl = await anchor.Program.fetchIdl(PROGRAM_ID!, provider);
    if (!idl) throw new Error("IDL not found for program");
    // Filter for processable lotteries
    const lotteryProgram = new anchor.Program(
        idl,
        provider
    );
    const [lotteryAccount, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from(lotteryId)],
        lotteryProgram.programId
    );
    const status = await lotteryProgram.methods.getStatus(lotteryId).accounts({ lottery: lotteryAccount }).view();
    const statusNumeric = getNumericStatus(status);
    const statusDisplay = getStatusString(status);
    // console.log('Status:', status);
    return { statusNumeric, statusDisplay };
}