import { getEndedLotteries } from '@/lib/getEndedLotteries';
import { selectWinner } from '@/lib/selectWInner';

export async function GET(
    req: Request
) {
    if (req.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
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