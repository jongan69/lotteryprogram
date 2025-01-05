import { Lottery } from "@/types/lottery";

export const getEndedLotteries = async () => {
    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/getAllLotteries`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            throw new Error('Failed to fetch all lotteries');
        }

        const data = await response.json();
        console.log('Fetched all lotteries:', data.lotteries);

        const filteredLotteries = (data.lotteries || []).filter((lottery: Lottery) => {
            // Only show lotteries where lottery is not completed
            return lottery.status.statusNumeric !== 3; // Filter out completed/finalized lotteries
        });

        return filteredLotteries;
    } catch (error) {
        console.error('Error fetching ended lotteries:', error);
        return [];
    }
};