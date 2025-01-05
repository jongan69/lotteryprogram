export const selectWinner = async (lotteryId: string) => {
    console.log(`Processing lottery: ${lotteryId}`);
    try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/selectWinner`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'selectWinner',
        params: { lotteryId },
      }),
    });

    if (!response.ok) {
            throw new Error('Failed to select winner');
        }

        return response.json();
    } catch (error) {
        console.error('Error selecting winner:', error);
    }
};