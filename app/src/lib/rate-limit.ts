import { NextResponse } from 'next/server'

interface RateLimitData {
  timestamp: number
  count: number
}

const rateLimit = new Map<string, RateLimitData>()

export function checkRateLimit(sender: string): { allowed: boolean; error?: string } {
  const now = Date.now()
  const windowMs = 60 * 1000 // 1 minute window
  const maxRequests = 10 // max requests per window

  const rateLimitInfo = rateLimit.get(sender)

  if (!rateLimitInfo) {
    rateLimit.set(sender, { timestamp: now, count: 1 })
    return { allowed: true }
  }

  const { timestamp, count } = rateLimitInfo

  if (now - timestamp > windowMs) {
    // Reset window
    rateLimit.set(sender, { timestamp: now, count: 1 })
    return { allowed: true }
  }

  if (count >= maxRequests) {
    return {
      allowed: false,
      error: 'Too many messages. Please wait a minute.'
    }
  }

  // Increment count
  rateLimit.set(sender, { timestamp, count: count + 1 })
  return { allowed: true }
} 