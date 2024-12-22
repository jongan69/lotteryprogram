import { NextResponse } from 'next/server';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { LotteryProgram } from '@/types/lottery';
import { PROGRAM_ID, RPC_URL, ADMIN_KEY } from '@/lib/constants';
import { getStatus } from '@/lib/getStatus';

if (!PROGRAM_ID) {
    throw new Error('NEXT_PUBLIC_PROGRAM_ID is not configured.');
}

export async function GET() {
    try {
        // Validate environment variables
        if (!ADMIN_KEY) {
            return NextResponse.json(
                { error: 'Admin key not configured.' },
                { status: 500 }
            );
        }

        // Load admin keypair
        const adminKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_KEY));
        const connection = new Connection(RPC_URL);

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
        console.log(`Total lotteries found: ${lotteryAccounts.length}`);

        // Filter lotteries synchronously first
        const processableLotteries = lotteryAccounts.filter(({ account }) => {
            const hasEnded = account.endTime * 1000 < Date.now();
            const hasParticipants = account.participants && account.participants.length > 0;
            const isAdmin = account.admin.toString() === adminKeypair.publicKey.toString();
            return hasEnded && hasParticipants && isAdmin;
        });

        console.log(`Processable lotteries found: ${processableLotteries.length} for program ${PROGRAM_ID}`);

        // Get status for each lottery
        const lotteryData = await Promise.all(
            processableLotteries.map(async ({ account }) => ({
                lotteryId: account.lotteryId,
                status: await getStatus(account.lotteryId, provider),
                participants: account.participants,
                winner: account.winner || null,
            }))
        );

        // Return processed lottery data
        return NextResponse.json({
            lotteries: lotteryData,
            total: processableLotteries.length,
        });
    } catch (error: any) {
        console.error('Failed to find processable lotteries:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to find processable lotteries.' },
            { status: 500 }
        );
    }
}
