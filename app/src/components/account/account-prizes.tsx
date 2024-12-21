'use client'

import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useInterval } from 'react-use';
import * as anchor from '@coral-xyz/anchor';
import { Lottery } from '@/types/lottery';
import { isValidPublicKey } from '@/lib/utils';
import { useTransactionToast } from '../ui/ui-layout';

export function AccountLotteryPrizes() {
  const wallet = useWallet()
  const { connection } = useConnection()
  const [lotteries, setLotteries] = useState<Lottery[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingLotteryId, setProcessingLotteryId] = useState<string | null>(null);
  const [claimingLotteryId, setClaimingLotteryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allLotteries, setAllLotteries] = useState<Lottery[]>([]);
  const [tableLoading, setTableLoading] = useState(true);
  const POLL_INTERVAL = 100000; // 100 seconds
  const transactionToast = useTransactionToast()

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
      console.log('Fetched lotteries:', data.lotteries);
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
      console.log('Fetched all lotteries:', data.lotteries);
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
      console.log('Attempting to claim prize:', {
        lotteryId,
        winner: wallet.publicKey?.toString(),
        creator: creator.toString()
      });

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
            participant: { publicKey: wallet.publicKey.toString() },
            creator: creator.toString()
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to claim prize');
      }

      const { transaction: serializedTransaction } = await response.json();

      // Convert the serialized transaction from base64 to Uint8Array
      const transactionBuffer = Buffer.from(serializedTransaction, 'base64');

      // Deserialize and sign the partially signed transaction
      const transaction = anchor.web3.VersionedTransaction.deserialize(
        transactionBuffer
      );

      // Player signs the admin-signed transaction
      const signed = await wallet.signTransaction(transaction);

      // Send the fully signed transaction
      const signature = await connection.sendRawTransaction(signed.serialize());

      // Replace the deprecated confirmTransaction call
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        ...latestBlockhash
      });
      console.log("Claimed prize successfully");
      transactionToast(signature);
      // Immediately update the local state
      setAllLotteries(prevLotteries =>
        prevLotteries.map(lottery =>
          lottery.lotteryId === lotteryId
            ? { ...lottery, status: 3 }
            : lottery
        )
      );

      setLotteries(prevLotteries =>
        prevLotteries.filter(lottery => lottery.lotteryId !== lotteryId)
      );

      // Optional: Fetch fresh data from the server
      await Promise.all([
        fetchLotteries(),
        fetchAllLotteries()
      ]);
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
        (lottery: Lottery) => lottery.status === 1
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

  const renderTableRow = (lottery: Lottery) => {
    console.log('Rendering lottery row:', {
      lotteryId: lottery.lotteryId,
      status: lottery.status,
      winner: lottery.winner,
      currentAddress: wallet.publicKey?.toString(),
      shouldShowClaim: lottery.status === 2 &&
        lottery.winner?.toString() === wallet.publicKey?.toString(),
      addressMatch: lottery.winner?.toString() === wallet.publicKey?.toString()
    });

    const prizeAmountSol = lottery.totalPrize ?
      (lottery.totalPrize.toNumber() / 1000000000).toFixed(2) :
      'N/A';

    return (
      <tr key={`table-${lottery.lotteryId}`} className="hover:bg-base-300">
        <td className="whitespace-nowrap max-w-[4rem] truncate">
          {lottery.lotteryId.toString()}
        </td>
        <td className="whitespace-nowrap max-w-[4rem] truncate">
          {(lottery.participants || 0).toString()}
        </td>
        <td className="whitespace-nowrap max-w-[6rem] truncate">
          {`${prizeAmountSol} SOL`}
        </td>
        <td className="whitespace-nowrap max-w-[8rem] truncate hidden md:table-cell font-mono">
          {lottery.winner
            ? `${lottery.winner.toString().slice(0, 4)}...${lottery.winner.toString().slice(-4)}`
            : 'Pending'}
        </td>
        <td className="whitespace-nowrap hidden md:table-cell">
          {lottery.creator ? lottery.creator.toString() : ''}
        </td>
        <td className="whitespace-nowrap">
          {lottery.status === 2 &&
            lottery.winner?.toString() === wallet.publicKey?.toString() ? (
            <div className="tooltip" data-tip={
              !lottery.creator ? "Missing creator address" :
                !isValidPublicKey(lottery.creator.toString()) ? "Invalid creator address" :
                  claimingLotteryId === lottery.lotteryId ? "Processing claim..." :
                    !wallet.publicKey ? "Please connect your wallet" :
                      "Click to claim your prize"
            }>
              <button
                className="btn btn-xs btn-primary"
                onClick={() => {
                  console.log('Claim button clicked:', {
                    lotteryId: lottery.lotteryId,
                    winner: lottery.winner,
                    currentAddress: wallet.publicKey?.toString(),
                    creator: lottery.creator
                  });
                  lottery.creator ? claimPrize(lottery.lotteryId, new PublicKey(lottery.creator)) : null;
                }}
                disabled={
                  claimingLotteryId === lottery.lotteryId ||
                  !lottery.creator ||
                  !isValidPublicKey(new PublicKey(lottery.creator).toString()) ||
                  !wallet.publicKey
                }
              >
                {claimingLotteryId === lottery.lotteryId ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  'Claim'
                )}
              </button>
            </div>
          ) : (
            <span className={`badge ${lottery.status === 3
                ? 'badge-neutral'
                : lottery.status === 2
                  ? 'badge-success'
                  : lottery.status === 1
                    ? 'badge-warning'
                    : 'badge-info'
              }`}>
              {lottery.status === 3 ? 'finalized' 
                : lottery.status === 2 ? 'completed'
                : lottery.status === 1 ? 'pending'
                : 'unknown'}
            </span>
          )}
        </td>
      </tr>
    );
  };

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
