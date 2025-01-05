import { getEndedLotteries } from '@/lib/getEndedLotteries';
import { selectWinner } from '@/lib/selectWInner';
import type { NextApiRequest, NextApiResponse } from 'next';

export async function GET(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const lotteries = await getEndedLotteries();
        console.log('Lotteries:', lotteries);
        for (const lottery of lotteries) {
            await selectWinner(lottery.id);
        }
        return new Response(`Successfully picked winners for ${lotteries.length} lotteries`);
    } catch (error: any) {
        console.error('Cron job failed:', error);
        return new Response(`Cron job failed: ${error?.message}`);
    }
}