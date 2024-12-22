import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { ObjectId } from 'mongodb'
import { checkRateLimit } from '@/lib/rate-limit'

export async function GET() {
  try {
    const client = await clientPromise
    const db = client.db("solottery")
    
    const messages = await db
      .collection("messages")
      .find({})
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray()

    return NextResponse.json(messages.reverse())
  } catch (error) {
    console.error('Database Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const client = await clientPromise
    const db = client.db("solottery")
    
    const message = await req.json()
    
    // Check rate limit
    const rateLimitResult = checkRateLimit(message.sender)
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: rateLimitResult.error },
        { status: 429 }
      )
    }

    // Validate message
    if (!message.text?.trim() || !message.sender || !message.senderAddress) {
      return NextResponse.json(
        { error: 'Invalid message format' },
        { status: 400 }
      )
    }

    const newMessage = {
      ...message,
      _id: new ObjectId(),
      createdAt: new Date(),
    }

    await db.collection("messages").insertOne(newMessage)

    // Clean up old messages if there are more than 100
    const count = await db.collection("messages").countDocuments()
    if (count > 100) {
      const messagesToDelete = count - 100
      await db.collection("messages")
        .find()
        .sort({ timestamp: 1 })
        .limit(messagesToDelete)
        .toArray()
        .then(oldMessages => {
          const oldMessageIds = oldMessages.map(m => m._id)
          return db.collection("messages").deleteMany({
            _id: { $in: oldMessageIds }
          })
        })
    }

    return NextResponse.json({ success: true, message: newMessage })
  } catch (error) {
    console.error('Database Error:', error)
    return NextResponse.json(
      { error: 'Failed to save message' },
      { status: 500 }
    )
  }
} 