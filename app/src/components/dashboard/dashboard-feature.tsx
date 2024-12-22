'use client'

import { useEffect, useState, useCallback } from 'react'
import { AppHero } from '../ui/ui-layout'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { Button } from '@/components/ui/button'
import { Lottery, LotteryListItem, PastLottery } from '@/types/lottery'
import { getProgram } from '@/lib/getProgram'
import { useCluster } from '../cluster/cluster-data-access'
import { WalletButton } from '../solana/solana-provider'
import { ChatFeature } from '../chat/chat-feature'


export default function DashboardFeature() {
  const { connection } = useConnection()
  const { cluster } = useCluster()
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
        console.log('Program ID:', programId, 'on:', cluster.network)
        setPROGRAM_ID(new PublicKey(programId))
      } catch (err) {
        console.error('Failed to fetch program ID:', err)
        setError('Failed to fetch program ID')
      }
    }

    fetchProgramId()
  }, [cluster.network])

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
  const buyTicket = async (lotteryStateToUse: Lottery) => {
    if (!wallet.publicKey || !wallet.signTransaction || !selectedLotteryId || !PROGRAM_ID) return

    try {
      // Check if buyer is the creator
      if (wallet.publicKey.equals(lotteryStateToUse.creator)) {
        setError('Lottery creators cannot buy tickets to their own lottery');
        return;
      }

      const currentTime = Math.floor(Date.now() / 1000)
      const endTime = lotteryStateToUse.endTime.toNumber()

      if (currentTime >= endTime) {
        setError('This lottery has ended')
        return
      }

      setLoading(true)
      const program = await memoizedGetProgram()
      const lotteryPDA = getLotteryPDA(selectedLotteryId)

      // Create the buy ticket instruction
      const buyTicketIx = await program.methods
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
        instructions: [buyTicketIx], // Include both instructions
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
    if (!PROGRAM_ID) return;

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
  }, [PROGRAM_ID, memoizedGetProgram]);

  useEffect(() => {
    // Create an async function inside useEffect
    const fetchData = async () => {
      await fetchAllLotteries()
    }

    fetchData() // Call it immediately
    const interval = setInterval(fetchData, 10000) // Use the same async function for interval
    return () => clearInterval(interval)
  }, [fetchAllLotteries])

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

  // Update fetchPastLotteries callback
  const fetchPastLotteries = useCallback(async () => {
    if (!PROGRAM_ID) return;

    try {
      setLoading(true);
      const program = await memoizedGetProgram();

      const accounts = await program.account.lotteryState.all();

      console.log('Accounts:', accounts); // Debug log
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
        })
        .filter((lottery: PastLottery) => {
          const endTime = lottery.account.endTime.toNumber() * 1000;
          const hasEnded = endTime <= Date.now();
          // Only check if it has ended, don't filter by winner
          return hasEnded;
        })
        .sort((a, b) => b.account.endTime.toNumber() - a.account.endTime.toNumber())
        .slice(0, 10);

      console.log('Completed lotteries:', completedLotteries); // Debug log
      setPastLotteries(completedLotteries);
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
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] bg-base-200 pt-8 w-full">
        <div className="hero-content text-center max-w-4xl">
          <div>
            <h1 className="text-5xl font-bold mb-8 animate-pulse">
              🎲 SOLottery: Where Dreams Go Moon! 🚀
            </h1>
            <div className="text-2xl mb-6 space-y-2">
              <p className="text-primary">
                🎵 All that glitters might be SOL
                <br />
                Only shooting stars break the FOMO 🎵
              </p>
            </div>
            <div className="py-4 text-xl mb-8 space-y-4">
              <p className="animate-bounce">
                🎯 Create or join lotteries with just a few clicks!
              </p>
              <div className="text-base-content/70 text-lg">
                <p>🏆 Winners take 85% of the pool</p>
                <p>👨‍💻 10% funds future development</p>
                <p>🎨 5% goes to lottery creators</p>
              </div>
            </div>

            {!wallet.publicKey && (
              <div className="flex flex-col items-center gap-4 mb-8">
                <div className="hover:animate-spin-once">
                  <WalletButton />
                </div>
                <p className="text-sm text-base-content/70">
                  No wallet? No problem! 🦊
                  <br />
                  <a
                    href="https://solana.com/developers/guides/getstarted/setup-local-development"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline hover:text-xl transition-all duration-300"
                  >
                    Click here to join the cool kids club 😎
                  </a>
                </p>
              </div>
            )}

            <div className="mt-4 text-xs opacity-50 hover:opacity-100 transition-opacity">
              * Not financial advice. Unless you win big, then we totally advised you.
              <br />
              ** Results may vary. Like, a lot. Actually, mostly varying towards not winning.
              <br />
              *** Your mom was right about saving money, but where&apos;s the fun in that?
            </div>
          </div>
        </div>
      </div>

      {/* Content section - make it full width */}
      <div className="w-full py-8">
        {/* Active lotteries - full width with padding */}
        <div className="bg-white shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300 mb-8">
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">
                🎮 Active Lotteries
              </h2>
              {wallet.publicKey && (
                <Button
                  onClick={() => setShowCreateForm(true)}
                  className="bg-primary hover:bg-primary-dark transform hover:scale-105 transition-transform duration-200"
                >
                  🎨 Create New Lottery
                </Button>
              )}
            </div>
            
            {/* Grid of lotteries */}
            <div className="grid gap-4 sm:grid-cols-2">
              {allLotteries.map((lottery) => {
                const prize = calculatePrize(
                  lottery.account.entryFee.toNumber(),
                  lottery.account.totalTickets
                )

                const isSelected = selectedLotteryId === lottery.account.lotteryId
                const currentTime = Math.floor(Date.now() / 1000)
                const isEnded = currentTime >= lottery.account.endTime.toNumber()
                const isCreator = wallet.publicKey?.equals(lottery.account.creator)

                return (
                  <div
                    key={lottery.publicKey.toString()}
                    className={`bg-white border rounded-lg p-4 transition-all duration-200 
                      ${isSelected
                        ? 'border-primary shadow-md ring-2 ring-primary ring-opacity-50'
                        : 'border-gray-200 hover:border-primary hover:shadow-md'}`}
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

                      {/* Modify Buy Ticket button section */}
                      <div className="pt-2">
                        {wallet.publicKey ? (
                          <Button
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedLotteryId(lottery.account.lotteryId)
                              buyTicket(lottery.account)
                            }}
                            disabled={loading || isEnded || isCreator}
                            className={`w-full ${
                              isEnded
                                ? 'bg-gray-300 cursor-not-allowed'
                                : isCreator
                                  ? 'bg-yellow-500 cursor-not-allowed'
                                  : 'bg-primary hover:bg-primary-dark'
                              } transition-colors duration-200`}
                          >
                            {isEnded ? '🔒 Lottery Ended' :
                              isCreator ? '👑 You are Creator' :
                                loading ? '⏳ Processing...' :
                                  '🎟️ Buy Ticket'}
                          </Button>
                        ) : (
                          <div className="text-center p-2 bg-gray-100 rounded-lg">
                            <WalletButton className="w-full" />
                            <p className="text-sm text-gray-600 mt-2">
                              Connect wallet to participate
                            </p>
                          </div>
                        )}
                        {error && (
                          <p className="text-red-500 text-sm mt-2 text-center">
                            {error}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Past lotteries - full width with padding */}
        <div className="bg-white shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300">
          <div className="p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              🏆 Hall of Fame: Recent Winners
            </h2>
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
                              : 'Pending Winner'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {new Date(lottery.account.endTime.toNumber() * 1000).toLocaleString()}
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

      {/* Keep create form modal inside wallet check */}
      {showCreateForm && wallet.publicKey && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white shadow-xl rounded-lg p-6 space-y-4 max-w-md w-full animate-fadeIn">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">🎨 Create Your Lucky Lottery</h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-gray-400 hover:text-gray-500 text-2xl hover:rotate-90 transition-transform duration-300"
              >
                ×
              </button>
            </div>
            <input
              type="text"
              value={newLotteryData.name}
              onChange={(e) => setNewLotteryData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Give it a catchy name! 🎵"
              className="w-full p-2 border rounded hover:border-primary focus:ring-2 focus:ring-primary transition-all duration-200"
            />
            <input
              type="number"
              value={newLotteryData.entryFee}
              onChange={(e) => setNewLotteryData(prev => ({ ...prev, entryFee: e.target.value }))}
              placeholder="Entry Fee (SOL) 💰"
              className="w-full p-2 border rounded hover:border-primary focus:ring-2 focus:ring-primary transition-all duration-200"
            />
            <input
              type="number"
              value={newLotteryData.duration}
              onChange={(e) => setNewLotteryData(prev => ({ ...prev, duration: e.target.value }))}
              placeholder="Duration in seconds (e.g. 3600 = 1 hour) ⏰"
              className="w-full p-2 border rounded hover:border-primary focus:ring-2 focus:ring-primary transition-all duration-200"
            />
            <Button
              onClick={createLottery}
              disabled={loading}
              className="w-full bg-gradient-to-r from-primary to-primary-dark hover:from-primary-dark hover:to-primary transform hover:scale-105 transition-all duration-200"
            >
              {loading ? '🎲 Rolling...' : '🎲 Create Lottery'}
            </Button>
          </div>
        </div>
      )}

      {wallet.publicKey && <ChatFeature />}
    </div>
  )
}
