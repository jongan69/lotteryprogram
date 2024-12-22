// Add helper function to get numeric status
export function getNumericStatus(status: any): number {
    if (typeof status === 'number') {
      return status;
    }
    // Handle object case
    if (status.active !== undefined) return 0;
    if (status.endedWaitingForWinner !== undefined) return 1;
    if (status.winnerSelected !== undefined) return 2;
    if (status.completed !== undefined) return 3;
    // If it's a raw number-like value, convert it
    if (status.toString) {
      const num = Number(status.toString());
      if (!isNaN(num)) return num;
    }
    return -1; // Invalid status
  }