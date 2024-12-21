import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const programId = process.env.NEXT_PUBLIC_PROGRAM_ID
    if (!programId) {
      throw new Error('Program ID not found in environment variables')
    }
    return NextResponse.json({ programId })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get program ID' },
      { status: 500 }
    )
  }
}