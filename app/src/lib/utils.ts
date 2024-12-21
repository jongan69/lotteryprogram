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

export const isValidPublicKey = (key: string | undefined): boolean => {
  if (!key) return false;
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
};