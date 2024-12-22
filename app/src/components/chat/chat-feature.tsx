'use client'

import { useState, useEffect } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'

interface ChatMessage {
  id: string
  text: string
  sender: string
  timestamp: number
  senderAddress: string
}

export function ChatFeature() {
  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const { publicKey } = useWallet()
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || !publicKey) return

    const newMessage = {
      id: Date.now().toString(),
      text: message.trim(),
      sender: publicKey.toString(),
      senderAddress: publicKey.toString(),
      timestamp: Date.now(),
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newMessage),
      })

      if (response.ok) {
        setMessages(prev => [...prev, newMessage])
        setMessage('')
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send message')
      }
    } catch (error: any) {
      console.error('Failed to send message:', error)
      setError(error.message || 'Failed to send message')
      setTimeout(() => setError(null), 3000)
    }
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`
  }

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const response = await fetch('/api/chat')
        if (response.ok) {
          const data = await response.json()
          setMessages(data)
        }
      } catch (error) {
        console.error('Failed to fetch messages:', error)
      }
    }

    if (isOpen) {
      fetchMessages()
      const interval = setInterval(fetchMessages, 5000)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  if (!publicKey) return null

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isOpen ? (
        <div className="bg-white/100 dark:bg-slate-900/100 backdrop-blur-xl rounded-lg shadow-2xl w-80 h-96 flex flex-col border-2">
          <div className="p-4 border-b flex justify-between items-center bg-white/100 dark:bg-slate-900/100">
            <h3 className="font-bold">Chat</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white/100 dark:bg-slate-900/100">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === publicKey.toString()
                    ? 'items-end'
                    : 'items-start'
                }`}
              >
                <div
                  className={`rounded-lg px-4 py-2 max-w-[80%] ${
                    msg.sender === publicKey.toString()
                      ? 'bg-primary text-white'
                      : 'bg-gray-200 dark:bg-slate-800'
                  }`}
                >
                  <div className="text-xs opacity-75 mb-1">
                    {formatAddress(msg.senderAddress)}
                  </div>
                  <div>{msg.text}</div>
                </div>
                <span className="text-xs text-gray-500 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="p-4 border-t bg-white/100 dark:bg-slate-900/100">
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 p-2 border rounded"
              />
              <Button type="submit">Send</Button>
            </div>
          </form>
        </div>
      ) : (
        <Button
          onClick={() => setIsOpen(true)}
          className="rounded-full w-12 h-12 flex items-center justify-center"
        >
          💬
        </Button>
      )}
    </div>
  )
} 