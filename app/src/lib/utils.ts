import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { LotteryStatus } from '@/types/lottery';
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