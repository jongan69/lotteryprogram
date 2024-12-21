import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

interface LotteryState {
  lotteryId: string;
  status: 'pending' | 'completed';
  processing?: boolean;
  participants?: number;
  winner?: string;
  prizeAmount?: number;
}

export function AccountLotteryPrizes({ address }: { address: PublicKey }) {
  const { publicKey } = useWallet();
  const [lotteries, setLotteries] = useState<LotteryState[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingLotteryId, setProcessingLotteryId] = useState<string | null>(null);
  const [claimingLotteryId, setClaimingLotteryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allLotteries, setAllLotteries] = useState<LotteryState[]>([]);
  const [tableLoading, setTableLoading] = useState(true);

  const fetchLotteries = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/findEndedLotteries', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch lotteries');
      }

      const data = await response.json();
      setLotteries(data.lotteries || []);
    } catch (err) {
      console.error('Error fetching lotteries:', err);
      setError('Failed to load lottery data');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllLotteries = async () => {
    try {
      setTableLoading(true);
      const response = await fetch('/api/getAllLotteries', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch all lotteries');
      }

      const data = await response.json();
      setAllLotteries(data.lotteries || []);
    } catch (err) {
      console.error('Error fetching all lotteries:', err);
    } finally {
      setTableLoading(false);
    }
  };

  const processLottery = async (lotteryId: string) => {
    try {
      console.log(`Processing lottery: ${lotteryId}`);
      setProcessingLotteryId(lotteryId);
      setError(null);
  
      const response = await fetch('/api/selectWinner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'selectWinner',
          params: { lotteryId },
        }),
      });
  
      if (!response.ok) {
        const errorResponse = await response.json();
        console.error(`Failed to process lottery: ${lotteryId}`, errorResponse);
        throw new Error(errorResponse.error || 'Failed to process lottery');
      }
  
      console.log(`Successfully processed lottery: ${lotteryId}`);
      await fetchLotteries();
    } catch (err) {
      console.error(`Error processing lottery ${lotteryId}:`, err);
      setError(`Failed to process lottery ${lotteryId}`);
    } finally {
      setProcessingLotteryId(null);
      console.log(`Completed processing for lottery: ${lotteryId}`);
    }
  };  

  const claimPrize = async (lotteryId: string) => {
    try {
      setClaimingLotteryId(lotteryId);
      setError(null);

      const response = await fetch('/api/lotteryV2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'claimPrize',
          params: { lotteryId, participant: { publicKey: address.toString() } },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to claim prize');
      }

      await fetchLotteries();
    } catch (err) {
      console.error(`Error claiming prize for lottery ${lotteryId}:`, err);
      setError('Failed to claim prize');
    } finally {
      setClaimingLotteryId(null);
    }
  };

  useEffect(() => {
    if (publicKey) {
      fetchLotteries();
      fetchAllLotteries();
    }
  }, [publicKey]);

  if (loading) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Lottery Prizes</h2>
        <div className="flex justify-center">
          <span className="loading loading-spinner"></span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Lottery Prizes</h2>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="text-xl font-semibold">Past Lotteries</h3>
          {tableLoading ? (
            <div className="flex justify-center py-4">
              <span className="loading loading-spinner"></span>
            </div>
          ) : allLotteries.length > 0 ? (
            <div className="overflow-x-auto -mx-6">
              <table className="table w-full">
                <thead>
                  <tr className="bg-base-300">
                    <th className="whitespace-nowrap">Lottery ID</th>
                    <th className="whitespace-nowrap">Players</th>
                    <th className="whitespace-nowrap">Prize</th>
                    <th className="whitespace-nowrap hidden md:table-cell">Winner</th>
                    <th className="whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allLotteries
                    .sort((a, b) => Number(b.lotteryId) - Number(a.lotteryId))
                    .map(lottery => (
                      <tr key={`table-${lottery.lotteryId}`} className="hover:bg-base-300">
                        <td className="whitespace-nowrap max-w-[4rem] truncate">
                          {lottery.lotteryId}
                        </td>
                        <td className="whitespace-nowrap max-w-[4rem] truncate">
                          {lottery.participants || 0}
                        </td>
                        <td className="whitespace-nowrap max-w-[6rem] truncate">
                          {lottery.prizeAmount ? `${lottery.prizeAmount} SOL` : 'N/A'}
                        </td>
                        <td className="whitespace-nowrap max-w-[8rem] truncate hidden md:table-cell font-mono">
                          {lottery.winner 
                            ? `${lottery.winner.slice(0, 4)}...${lottery.winner.slice(-4)}` 
                            : 'Pending'}
                        </td>
                        <td className="whitespace-nowrap max-w-[6rem]">
                          <span className={`badge truncate ${
                            lottery.processing 
                              ? 'badge-warning' 
                              : lottery.status === 'completed' 
                                ? 'badge-success' 
                                : 'badge-info'
                          }`}>
                            {lottery.processing ? 'Processing...' : lottery.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="alert">No lotteries found</div>
          )}
        </div>
      </div>

      {lotteries.length > 0 ? (
        <div className="space-y-4">
          {lotteries.map((lottery) => (
            <div key={lottery.lotteryId} className="card bg-base-200">
              <div className="card-body">
                <h3 className="card-title">Lottery #{lottery.lotteryId}</h3>
                <div className="space-y-2">
                  <p>Status: {lottery.processing ? 'Processing...' : lottery.status}</p>
                </div>
                {lottery.status === 'pending' && !lottery.processing && (
                  <div className="card-actions justify-end">
                    <button
                      className="btn btn-secondary"
                      onClick={() => processLottery(lottery.lotteryId)}
                      disabled={processingLotteryId === lottery.lotteryId}
                    >
                      {processingLotteryId === lottery.lotteryId ? (
                        <span className="loading loading-spinner"></span>
                      ) : (
                        'Select Winner'
                      )}
                    </button>
                  </div>
                )}
                {lottery.status === 'completed' && (
                  <div className="card-actions justify-end">
                    <button
                      className="btn btn-primary"
                      onClick={() => claimPrize(lottery.lotteryId)}
                      disabled={claimingLotteryId === lottery.lotteryId}
                    >
                      {claimingLotteryId === lottery.lotteryId ? (
                        <span className="loading loading-spinner"></span>
                      ) : (
                        'Claim Prize'
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="alert">No lotteries found</div>
      )}
    </div>
  );
}
