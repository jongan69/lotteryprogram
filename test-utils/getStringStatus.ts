import { LotteryStatus } from "./types";

export function getStatusString(status: any): string {
    // Handle object-style status from Anchor
    if (typeof status === 'object') {
        if (status.active !== undefined) return 'active';
        if (status.endedWaitingForWinner !== undefined) return 'pending';
        if (status.winnerSelected !== undefined) return 'winner_selected';
        if (status.completed !== undefined) return 'completed';
    }

    // Handle numeric status
    switch (status) {
        case LotteryStatus.Active:
            return 'active';
        case LotteryStatus.EndedWaitingForWinner:
            return 'pending';
        case LotteryStatus.WinnerSelected:
            return 'winner_selected';
        case LotteryStatus.Completed:
            return 'completed';
        default:
            return 'unknown';
    }
}