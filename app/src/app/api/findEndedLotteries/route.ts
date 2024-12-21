import { NextResponse } from 'next/server';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as sb from '@switchboard-xyz/on-demand';
import bs58 from 'bs58';

const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID
    ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
    : null;

if (!PROGRAM_ID) {
    throw new Error('NEXT_PUBLIC_PROGRAM_ID is not configured.');
}

type LotteryProgram = anchor.Program<anchor.Idl> & {
    account: {
        lotteryState: {
            fetch(address: PublicKey): Promise<any>;
            all(): Promise<any[]>;
        };
    };
};

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
        console.log(`Total lotteries found: ${lotteryAccounts.length}`);

        // Filter for processable lotteries
        const processableLotteries = lotteryAccounts.filter(({ account }) => {
            const hasEnded = account.endTime * 1000 < Date.now();
            const hasNoWinner = !account.winner;
            const hasParticipants = account.participants && account.participants.length > 0;
            const isAdmin = account.admin.toString() === adminKeypair.publicKey.toString();

            return hasEnded && hasNoWinner && hasParticipants && isAdmin;
        });

        console.log(`Processable lotteries found: ${processableLotteries.length}`);

        // Return processable lotteries
        return NextResponse.json({
            lotteries: processableLotteries.map(({ account }) => ({
                lotteryId: account.lotteryId,
                status: account.winner ? 'completed' : 'pending',
                participants: account.participants,
                winner: account.winner || null,
            })),
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
