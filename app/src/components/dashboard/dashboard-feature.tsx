'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppHero } from '../ui/ui-layout'
import { useConnection, useWallet, WalletContextState } from '@solana/wallet-adapter-react'
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import * as anchor from "@coral-xyz/anchor"

interface LotteryState {
  lotteryId: string
  admin: PublicKey
  creator: PublicKey
  entryFee: anchor.BN
  totalTickets: number
  participants: PublicKey[]
  endTime: anchor.BN
  winner: PublicKey | null
}

interface LotteryListItem {
  publicKey: PublicKey
  account: LotteryState
}

type LotteryProgram = anchor.Program<anchor.Idl> & {
  account: {
    lotteryState: {
      fetch(address: PublicKey): Promise<LotteryState>;
      all(): Promise<{ publicKey: PublicKey; account: LotteryState }[]>;
    }
  }
}

// Move getProgram outside the component or memoize it inside
const getProgram = async (connection: Connection, wallet: WalletContextState, PROGRAM_ID: PublicKey): Promise<LotteryProgram> => {
  if (!PROGRAM_ID) throw new Error("Program ID not initialized")
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: wallet.publicKey!,
      signTransaction: wallet.signTransaction!,
      signAllTransactions: wallet.signAllTransactions!,
    } as anchor.Wallet,
    { commitment: 'confirmed' }
  )
  anchor.setProvider(provider)

  // Fetch IDL from chain
  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
  if (!idl) throw new Error("IDL not found")
  return new anchor.Program(idl, provider) as LotteryProgram
}

export default function DashboardFeature() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [lotteryState, setLotteryState] = useState<LotteryState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allLotteries, setAllLotteries] = useState<LotteryListItem[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newLotteryData, setNewLotteryData] = useState({
    name: '',
    entryFee: '0.1',
    duration: '3600'
  })
  const [selectedLotteryId, setSelectedLotteryId] = useState<string | null>(null)
  const [PROGRAM_ID, setPROGRAM_ID] = useState<PublicKey | null>(null)
  // Add this effect at the component level (inside DashboardFeature)
  useEffect(() => {
    const fetchProgramId = async () => {
      try {
        const response = await fetch('/api/getProgramId')
        if (!response.ok) throw new Error('Failed to fetch program ID')
        const { programId } = await response.json()
        setPROGRAM_ID(new PublicKey(programId))
      } catch (err) {
        console.error('Failed to fetch program ID:', err)
        setError('Failed to fetch program ID')
      }
    }

    fetchProgramId()
  }, [])

  // Memoize the getProgram function
  const memoizedGetProgram = useCallback(
    () => {
      if (!PROGRAM_ID) throw new Error("Program ID not initialized");
      return getProgram(connection, wallet, PROGRAM_ID);
    },
    [connection, wallet, PROGRAM_ID]
  );

  const getLotteryPDA = (lotteryId: string) => {
    if (!PROGRAM_ID) throw new Error("Program ID not initialized")
    const [lotteryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("lottery"), Buffer.from(lotteryId)],
      PROGRAM_ID
    )
    return lotteryPDA
  }

  // Function to fetch lottery state
  const fetchLotteryState = useCallback(async () => {
    if (!wallet.publicKey || !selectedLotteryId || !PROGRAM_ID) return;

    try {
      setLoading(true);
      const program = await memoizedGetProgram();
      const lotteryPDA = getLotteryPDA(selectedLotteryId);

      const account = await program.account.lotteryState.fetch(lotteryPDA);
      setLotteryState(account as LotteryState);
    } catch (err) {
      console.error('Failed to fetch lottery state:', err);
      setError('Failed to fetch lottery state');
    } finally {
      setLoading(false);
    }
  }, [wallet.publicKey, selectedLotteryId, PROGRAM_ID, memoizedGetProgram]);

  // Buy ticket function
  const buyTicket = async () => {
    if (!wallet.publicKey || !lotteryState || !wallet.signTransaction || !selectedLotteryId) return

    try {
      // Check if buyer is the creator
      if (wallet.publicKey.equals(lotteryState.creator)) {
        setError('Lottery creators cannot buy tickets to their own lottery');
        return;
      }

      const currentTime = Math.floor(Date.now() / 1000)
      const endTime = lotteryState.endTime.toNumber()

      if (currentTime >= endTime) {
        setError('This lottery has ended')
        return
      }

      setLoading(true)
      const program = await memoizedGetProgram()
      const lotteryPDA = getLotteryPDA(selectedLotteryId)

      // Create transfer instruction for entry fee
      const transferIx = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: lotteryPDA,
        lamports: lotteryState.entryFee.toNumber()
      })

      const ix = await program.methods
        .buyTicket(selectedLotteryId)
        .accounts({
          lottery: lotteryPDA,
          player: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction()

      const latestBlockhash = await connection.getLatestBlockhash()
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [transferIx, ix], // Add both instructions
      }).compileToV0Message()

      const transaction = new VersionedTransaction(messageV0)

      const signed = await wallet.signTransaction(transaction)
      const signature = await connection.sendTransaction(signed)
      await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      })

      await fetchLotteryState()
    } catch (err: any) {
      console.error('Failed to buy ticket:', err)
      // Handle specific program errors
      if (err.message?.includes('LotteryClosed')) {
        setError('This lottery has ended')
      } else if (err.message?.includes('MaxParticipantsReached')) {
        setError('Maximum participants reached')
      } else {
        setError('Failed to buy ticket: ' + (err.message || 'Unknown error'))
      }
    } finally {
      setLoading(false)
    }
  }

  // Claim prize function
  const claimPrize = async () => {
    if (!wallet.publicKey || !lotteryState || !wallet.signTransaction || !selectedLotteryId) return

    try {
      setLoading(true)
      const program = await memoizedGetProgram()
      const lotteryPDA = getLotteryPDA(selectedLotteryId)

      const ix = await program.methods
        .claimPrize(selectedLotteryId)
        .accounts({
          lottery: lotteryPDA,
          player: wallet.publicKey,
          creator: lotteryState.creator,
          developer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction()

      const latestBlockhash = await connection.getLatestBlockhash()
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [ix],
      }).compileToV0Message()

      const transaction = new VersionedTransaction(messageV0)

      const signed = await wallet.signTransaction(transaction)
      const signature = await connection.sendTransaction(signed)
      await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      })

      await fetchLotteryState()
    } catch (err) {
      console.error('Failed to claim prize:', err)
      setError('Failed to claim prize')
    } finally {
      setLoading(false)
    }
  }

  // Update the fetchAllLotteries callback
  const fetchAllLotteries = useCallback(async () => {
    if (!wallet.publicKey || !PROGRAM_ID) return;

    try {
      setLoading(true);
      const program = await memoizedGetProgram();

      const accounts = await program.account.lotteryState.all();

      const activeLotteries = accounts
        .map(({ publicKey, account }: { publicKey: PublicKey; account: any }) => ({
          publicKey,
          account: account as LotteryState
        }))
        .filter((lottery: LotteryListItem) => {
          const endTime = lottery.account.endTime.toNumber() * 1000
          return endTime > Date.now() && !lottery.account.winner
        })

      setAllLotteries(activeLotteries)
    } catch (err) {
      console.error('Failed to fetch lotteries:', err)
      setError('Failed to fetch active lotteries')
    } finally {
      setLoading(false)
    }
  }, [wallet.publicKey, PROGRAM_ID, memoizedGetProgram]);

  useEffect(() => {
    if (wallet.publicKey) {
      // Create an async function inside useEffect
      const fetchData = async () => {
        await fetchAllLotteries()
      }

      fetchData() // Call it immediately
      const interval = setInterval(fetchData, 10000) // Use the same async function for interval
      return () => clearInterval(interval)
    }
  }, [wallet.publicKey, fetchAllLotteries])

  useEffect(() => {
    if (selectedLotteryId) {
      fetchLotteryState()
    }
  }, [selectedLotteryId, fetchLotteryState])

  const createLottery = async () => {
    if (!wallet.publicKey) return
    if (!newLotteryData.name.trim()) {
      setError('Please enter a lottery name')
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/createLottery', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newLotteryData.name.trim(),
          entryFee: parseFloat(newLotteryData.entryFee),
          duration: parseInt(newLotteryData.duration),
          creator: wallet.publicKey.toString()
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create lottery')
      }

      const result = await response.json()
      console.log('Lottery created:', result)

      setShowCreateForm(false)
      await fetchAllLotteries()
    } catch (err: any) {
      console.error('Failed to create lottery:', err)
      setError(err.message || 'Failed to create lottery')
    } finally {
      setLoading(false)
    }
  }

  // Add a countdown timer component
  const CountdownTimer = ({ endTime }: { endTime: number }) => {
    const [timeLeft, setTimeLeft] = useState(Math.max(0, endTime * 1000 - Date.now()))

    useEffect(() => {
      const timer = setInterval(() => {
        const remaining = Math.max(0, endTime * 1000 - Date.now())
        setTimeLeft(remaining)
      }, 1000)
      return () => clearInterval(timer)
    }, [endTime])

    const minutes = Math.floor(timeLeft / 1000 / 60)
    const seconds = Math.floor((timeLeft / 1000) % 60)

    return (
      <span className={`font-mono ${timeLeft === 0 ? 'text-red-600' : 'text-emerald-600'}`}>
        {timeLeft === 0 ? 'Ended' : `${minutes}m ${seconds}s`}
      </span>
    )
  }

  // Add total prize calculation
  const calculatePrize = (entryFee: number, totalTickets: number) => {
    const totalPool = (entryFee * totalTickets) / LAMPORTS_PER_SOL
    return totalPool * 0.9 // 90% goes to winner
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <AppHero
        title="Solana Lottery"
        subtitle={
          <div className="space-y-2">
            <p>Try your luck in our decentralized lottery system!</p>
            <p className="text-sm text-gray-600">
              85% of the pool goes to the winner • 10% development fee • 5% goes to the creator!
            </p>
          </div>
        }
      />

      {error && (
        <div className="max-w-2xl mx-auto my-4 p-4 bg-red-50 border border-red-200 rounded-md text-red-600">
          {error}
        </div>
      )}

      {!wallet.publicKey ? (
        <div className="max-w-2xl mx-auto text-center py-12">
          <div className="bg-white rounded-xl shadow-md p-8">
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-gray-600 mb-4">
              Connect your Solana wallet to participate in lotteries or create your own!
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          {/* Active Lotteries Section */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Active Lotteries</h2>
                  <Button
                    onClick={() => setShowCreateForm(true)}
                    className="bg-primary hover:bg-primary-dark"
                  >
                    Create New Lottery
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {allLotteries.map((lottery) => {
                    const prize = calculatePrize(
                      lottery.account.entryFee.toNumber(),
                      lottery.account.totalTickets
                    )

                    return (
                      <div
                        key={lottery.publicKey.toString()}
                        className={`bg-white border rounded-lg p-4 cursor-pointer transition-all duration-200 
                          ${selectedLotteryId === lottery.account.lotteryId
                            ? 'border-primary shadow-md ring-2 ring-primary ring-opacity-50'
                            : 'border-gray-200 hover:border-primary hover:shadow-md'}`}
                        onClick={() => {
                          setSelectedLotteryId(lottery.account.lotteryId)
                          setLotteryState(lottery.account)
                        }}
                      >
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500">Name:</span>
                            <span className="font-semibold text-gray-900">{lottery.account.lotteryId}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500 pr-4">Prize Pool:</span>
                            <span className="font-bold text-primary">
                              {prize.toFixed(3)} SOL
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500">Entry Fee:</span>
                            <span className="font-semibold text-gray-900">
                              {lottery.account.entryFee.toNumber() / LAMPORTS_PER_SOL} SOL
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500">Tickets Sold:</span>
                            <span className="font-semibold text-gray-900">
                              {lottery.account.totalTickets}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-gray-500">Time Left:</span>
                            <CountdownTimer endTime={lottery.account.endTime.toNumber()} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Selected Lottery Details */}
          {lotteryState && (
            <div className="bg-white rounded-xl shadow-md overflow-hidden mt-6">
              <div className="p-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Selected Lottery Details</h2>
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-gray-500">Current Prize Pool</span>
                    <span className="font-bold text-primary text-lg">
                      {calculatePrize(
                        lotteryState.entryFee.toNumber(),
                        lotteryState.totalTickets
                      ).toFixed(3)} SOL
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-gray-500">Entry Fee</span>
                    <span className="font-semibold text-gray-900">
                      {lotteryState.entryFee.toNumber() / LAMPORTS_PER_SOL} SOL
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-gray-500">Total Tickets</span>
                    <span className="font-semibold text-gray-900">{lotteryState.totalTickets}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-gray-500">Time Remaining</span>
                    <CountdownTimer endTime={lotteryState.endTime.toNumber()} />
                  </div>
                  <div className="flex justify-between items-center py-2 border-b">
                    <span className="text-gray-500">Creator</span>
                    <span className="font-mono text-sm">
                      {`${lotteryState.creator.toString().slice(0, 4)}...${lotteryState.creator.toString().slice(-4)}`}
                    </span>
                  </div>

                  {wallet.publicKey && (
                    <div className="pt-4 space-y-3">
                      <Button
                        onClick={buyTicket}
                        disabled={
                          loading || 
                          Date.now() / 1000 > lotteryState.endTime.toNumber() ||
                          wallet.publicKey.equals(lotteryState.creator)
                        }
                        className="w-full bg-gradient-to-r from-primary to-primary-dark hover:from-primary-dark hover:to-primary"
                      >
                        {loading ? (
                          <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                            Processing...
                          </div>
                        ) : Date.now() / 1000 > lotteryState.endTime.toNumber()
                          ? 'Lottery Ended'
                          : wallet.publicKey.equals(lotteryState.creator)
                            ? 'Creators Cannot Buy Tickets to their own lottery'
                            : `Buy Ticket for ${lotteryState.entryFee.toNumber() / LAMPORTS_PER_SOL} SOL`
                        }
                      </Button>

                      {lotteryState.winner && lotteryState.winner.equals(wallet.publicKey) && (
                        <Button
                          onClick={claimPrize}
                          disabled={loading}
                          className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
                        >
                          {loading ? (
                            <div className="flex items-center justify-center">
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                              Claiming...
                            </div>
                          ) : 'Claim Prize'
                          }
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Create Form */}
          {showCreateForm && (
            <div className="bg-white shadow rounded-lg p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold">Create New Lottery</h2>
                <button onClick={() => setShowCreateForm(false)} className="text-gray-400 hover:text-gray-500">×</button>
              </div>
              <input
                type="text"
                value={newLotteryData.name}
                onChange={(e) => setNewLotteryData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Lottery Name"
                className="w-full p-2 border rounded"
              />
              <input
                type="number"
                value={newLotteryData.entryFee}
                onChange={(e) => setNewLotteryData(prev => ({ ...prev, entryFee: e.target.value }))}
                placeholder="Entry Fee (SOL)"
                className="w-full p-2 border rounded"
              />
              <input
                type="number"
                value={newLotteryData.duration}
                onChange={(e) => setNewLotteryData(prev => ({ ...prev, duration: e.target.value }))}
                placeholder="Duration in seconds (e.g. 3600 = 1 hour)"
                className="w-full p-2 border rounded"
              />
              <Button onClick={createLottery} disabled={loading}>Create Lottery</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}