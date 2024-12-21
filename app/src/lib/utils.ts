import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { LotteryStatus } from '@/types/lottery';
import { PublicKey } from '@solana/web3.js';
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getStatusString(status: number): string {
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

export const isValidPublicKey = (key: string | undefined): boolean => {
  if (!key) return false;
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
};