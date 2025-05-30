import { NextResponse } from 'next/server';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { LotteryProgram } from '@/types/lottery';
import { getStatus } from '@/lib/getStatus';
import { PROGRAM_ID } from '@/lib/constants';

if (!PROGRAM_ID) {
    throw new Error('NEXT_PUBLIC_PROGRAM_ID is not configured.');
}

export async function GET() {
    try {
        // Validate environment variables
        if (!process.env.ADMIN_KEY) {
            return NextResponse.json(
                { error: 'Admin key not configured.' },
                { status: 500 }
            );
        }

        // Load admin keypair
        const adminKeypair = Keypair.fromSecretKey(bs58.decode(process.env.ADMIN_KEY));
        const connection = new Connection(process.env.RPC_URL!);

        // Create a wallet adapter from the keypair
        const wallet = {
            publicKey: adminKeypair.publicKey,
            signTransaction: (tx: any) => Promise.resolve(tx.sign([adminKeypair])),
            signAllTransactions: (txs: any[]) => Promise.all(txs.map(tx => tx.sign([adminKeypair]))),
        };

        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: 'confirmed'
        });

        // Load lottery program
        const idl = await anchor.Program.fetchIdl(PROGRAM_ID!, provider);
        if (!idl) throw new Error('IDL not found for the lottery program.');
        const program = new anchor.Program(idl, provider) as LotteryProgram;

        // Fetch all lottery accounts
        console.log('Fetching all lottery accounts...');
        const lotteryAccounts = await program.account.lotteryState.all();
        console.log(`Total lotteries found: ${lotteryAccounts.length} for program ${PROGRAM_ID}`);

        // Filter and process lotteries
        const processableLotteries = lotteryAccounts.filter(({ account }) => {
            const hasEnded = account.endTime * 1000 < Date.now();
            const hasParticipants = account.participants.length > 0;
            // Don't filter out lotteries with winners since they're now permanent records
            return hasEnded && hasParticipants;
        });

        // Get status for each lottery
        const lotteryData = await Promise.all(
            processableLotteries.map(async ({ account }) => ({
                lotteryId: account.lotteryId,
                status: await getStatus(account.lotteryId, provider),
                admin: account.admin.toString(),
                creator: account.creator.toString(),
                participants: account.participants,
                totalPrize: account.totalPrize,
                winner: account.winner?.toString() || null,
                endTime: account.endTime.toNumber(),
                totalTickets: account.totalTickets,
            }))
        );

        // Return all lotteries
        return NextResponse.json({
            lotteries: lotteryData,
            total: processableLotteries.length,
        });
    } catch (error: any) {
        console.error('Failed to fetch lotteries:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch lotteries.' },
            { status: 500 }
        );
    }
}
