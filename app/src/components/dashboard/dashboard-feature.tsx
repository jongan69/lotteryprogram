'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppHero } from '../ui/ui-layout'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { Lottery, LotteryListItem, PastLottery } from '@/types/lottery'
import { getProgram } from '@/lib/getProgram'


export default function DashboardFeature() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const [lotteryState, setLotteryState] = useState<Lottery | null>(null)
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
  const [pastLotteries, setPastLotteries] = useState<PastLottery[]>([]);

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

  // Update the memoizedGetProgram callback
  const memoizedGetProgram = useCallback(
    () => {
      if (!PROGRAM_ID) throw new Error("Program ID not initialized");
      return getProgram(connection, wallet.publicKey ? wallet : null, PROGRAM_ID);
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
  /* eslint-disable react-hooks/exhaustive-deps */
  const fetchLotteryState = useCallback(async () => {
    if (!wallet.publicKey || !selectedLotteryId || !PROGRAM_ID) return;

    try {
      setLoading(true);
      const program = await memoizedGetProgram();
      const lotteryPDA = getLotteryPDA(selectedLotteryId);

      const account = await program.account.lotteryState.fetch(lotteryPDA);
      setLotteryState(account as Lottery);
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

      // Remove the transferIx and just use the program instruction
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
        instructions: [ix], // Remove transferIx, only use the program instruction
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
          account: account as Lottery
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

  // Update fetchPastLotteries to not check for wallet
  const fetchPastLotteries = useCallback(async () => {
    if (!PROGRAM_ID) return;

    try {
      setLoading(true);
      const program = await memoizedGetProgram();

      const accounts = await program.account.lotteryState.all();
      console.log('All lottery accounts:', accounts);

      const completedLotteries = accounts
        .map(({ publicKey, account }: { publicKey: PublicKey; account: any }) => {
          const lotteryState = account as Lottery;
          const prizeAmount = calculatePrize(
            lotteryState.entryFee.toNumber(),
            lotteryState.totalTickets
          );

          return {
            publicKey,
            account: lotteryState,
            prizeAmount,
            winnerAddress: lotteryState.winner ? lotteryState.winner.toString() : ''
          };
        });

      console.log('Mapped lotteries:', completedLotteries);

      const filteredLotteries = completedLotteries
        .filter((lottery: PastLottery) => {
          const endTime = lottery.account.endTime.toNumber() * 1000;
          const hasEnded = endTime <= Date.now();
          const isCompleted = lottery.account.status === 3;
          const hasWinnerSelected = lottery.account.status === 2;

          console.log('Lottery:', {
            id: lottery.account.lotteryId,
            endTime: new Date(endTime),
            hasEnded,
            isCompleted,
            hasWinnerSelected,
            status: lottery.account.status,
            winner: lottery.account.winner?.toString()
          });

          return hasEnded && (isCompleted || hasWinnerSelected);
        })
        .sort((a, b) => b.account.endTime.toNumber() - a.account.endTime.toNumber())
        .slice(0, 10);

      console.log('Final filtered lotteries:', filteredLotteries);

      setPastLotteries(filteredLotteries);
    } catch (err) {
      console.error('Failed to fetch past lotteries:', err);
      setError('Failed to fetch past lotteries');
    } finally {
      setLoading(false);
    }
  }, [PROGRAM_ID, memoizedGetProgram]);

  useEffect(() => {
    fetchPastLotteries();

    const interval = setInterval(fetchPastLotteries, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [fetchPastLotteries]);

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
        <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-xl shadow-md p-8 mb-8">
            <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
            <p className="text-gray-600 mb-4">
              Connect your Solana wallet to participate in lotteries or create your own!
            </p>
          </div>

          {/* Past Lotteries Section */}
          <div className="bg-white rounded-xl shadow-md overflow-hidden">
            <div className="p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Recent Winners</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Lottery Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Prize Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Winner
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        End Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-center text-gray-500">
                          Loading recent winners...
                        </td>
                      </tr>
                    ) : pastLotteries.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-center text-gray-500">
                          No completed lotteries yet
                        </td>
                      </tr>
                    ) : (
                      pastLotteries.map((lottery) => (
                        <tr key={lottery.publicKey.toString()}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {lottery.account.lotteryId}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">
                              {lottery.prizeAmount.toFixed(3)} SOL
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500 font-mono">
                              {lottery.winnerAddress
                                ? `${lottery.winnerAddress.slice(0, 4)}...${lottery.winnerAddress.slice(-4)}`
                                : 'No Winner'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {new Date(lottery.account.endTime.toNumber() * 1000).toLocaleDateString()}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
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
                    <div className="pt-4">
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
