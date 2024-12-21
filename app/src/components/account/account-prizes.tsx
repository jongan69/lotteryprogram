import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useInterval } from 'react-use';
import * as anchor from '@coral-xyz/anchor';

interface LotteryState {
  lotteryId: string;
  status: 'pending' | 'completed' | 'finalized';
  processing?: boolean;
  participants?: number;
  winner?: string;
  prizeAmount?: number;
  creator?: string;
}

const isValidPublicKey = (key: string | undefined): boolean => {
  if (!key) return false;
  try {
    new PublicKey(key);
    return true;
  } catch {
    return false;
  }
};

export function AccountLotteryPrizes({ address }: { address: PublicKey }) {
  const wallet = useWallet()

  const { connection } = useConnection()
  const [lotteries, setLotteries] = useState<LotteryState[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingLotteryId, setProcessingLotteryId] = useState<string | null>(null);
  const [claimingLotteryId, setClaimingLotteryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allLotteries, setAllLotteries] = useState<LotteryState[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const POLL_INTERVAL = 100000; // 100 seconds

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

  const claimPrize = async (lotteryId: string, creator: PublicKey) => {
    try {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error('Wallet not connected');
      }
      
      if (!isValidPublicKey(creator.toString())) {
        throw new Error('Invalid creator address');
      }
      
      setClaimingLotteryId(lotteryId);
      setError(null);

      const response = await fetch('/api/collectPrize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'collectPrize',
          params: { 
            lotteryId, 
            participant: { publicKey: address.toString() },
            creator: creator.toString()
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to claim prize');
      }

      const { transaction: serializedTransaction } = await response.json();
      
      // Deserialize and sign the partially signed transaction
      const transaction = anchor.web3.VersionedTransaction.deserialize(
        Buffer.from(serializedTransaction)
      );
      
      // Player signs the admin-signed transaction
      const signed = await wallet.signTransaction(transaction);
      
      // Send the fully signed transaction
      const signature = await connection.sendRawTransaction(signed.serialize());
      
      await connection.confirmTransaction(signature);
      console.log("Claimed prize successfully");
      
      await fetchLotteries();
    } catch (err) {
      console.error(`Error claiming prize for lottery ${lotteryId}:`, err);
      setError(err instanceof Error ? err.message : 'Failed to claim prize');
    } finally {
      setClaimingLotteryId(null);
    }
  };

  const checkAndProcessPendingLotteries = async () => {
    try {
      const response = await fetch('/api/findEndedLotteries', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch lotteries');
      }

      const data = await response.json();
      const pendingLotteries = data.lotteries?.filter(
        (lottery: LotteryState) => lottery.status === 'pending' && !lottery.processing
      );

      for (const lottery of pendingLotteries) {
        await processLottery(lottery.lotteryId);
      }
    } catch (err) {
      console.error('Error checking pending lotteries:', err);
    }
  };

  useInterval(() => {
    if (wallet.publicKey) {
      checkAndProcessPendingLotteries();
    }
  }, POLL_INTERVAL);

  const renderTableRow = (lottery: LotteryState) => (
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
      <td className="whitespace-nowrap hidden md:table-cell">
        {lottery.creator}
      </td>
      <td className="whitespace-nowrap">
        {lottery.status === 'completed' && 
         lottery.winner === address.toString() ? (
          <div className="tooltip" data-tip={
            !lottery.creator ? "Missing creator address" :
            !isValidPublicKey(lottery.creator) ? "Invalid creator address" :
            claimingLotteryId === lottery.lotteryId ? "Processing claim..." :
            "Click to claim your prize"
          }>
            <button
              className="btn btn-xs btn-primary"
              onClick={() => lottery.creator ? claimPrize(lottery.lotteryId, new PublicKey(lottery.creator)) : null}
              disabled={claimingLotteryId === lottery.lotteryId || !lottery.creator || !isValidPublicKey(lottery.creator)}
            >
              {claimingLotteryId === lottery.lotteryId ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                'Claim'
              )}
            </button>
          </div>
        ) : (
          <span className={`badge truncate ${
            lottery.processing 
              ? 'badge-warning' 
              : lottery.status === 'finalized'
                ? 'badge-neutral'
                : lottery.status === 'completed' 
                  ? 'badge-success' 
                  : 'badge-info'
          }`}>
            {lottery.processing ? 'Processing...' : lottery.status}
          </span>
        )}
      </td>
    </tr>
  );

  useEffect(() => {
    if (wallet.publicKey) {
      fetchLotteries();
      fetchAllLotteries();
    }
  }, [wallet.publicKey]);

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
                    <th className="whitespace-nowrap hidden md:table-cell">Creator</th>
                    <th className="whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allLotteries
                    .sort((a, b) => Number(b.lotteryId) - Number(a.lotteryId))
                    .map(lottery => renderTableRow(lottery))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="alert">No lotteries found</div>
          )}
        </div>
      </div>
    </div>
  );
}
