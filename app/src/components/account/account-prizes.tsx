'use client'

import { useEffect, useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useInterval } from 'react-use';
import * as anchor from '@coral-xyz/anchor';
import { Lottery } from '@/types/lottery';
import { isValidPublicKey } from '@/lib/utils';
import { useTransactionToast } from '../ui/ui-layout';
import { truncateAddress } from '@/lib/utils';
import { selectWinner } from '@/lib/selectWInner';

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
  const POLL_INTERVAL = 30000; // 30 seconds
  const transactionToast = useTransactionToast()
  const [userLotteries, setUserLotteries] = useState<Lottery[]>([]);

  const fetchLotteries = useCallback(async () => {
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
  }, []);

  const fetchAllLotteries = useCallback(async () => {
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
      
      const filteredLotteries = (data.lotteries || []).filter((lottery: Lottery) => {
        // Only show lotteries where user is a participant AND lottery is not completed
        return lottery.participants?.some(
          (participant: PublicKey) => participant.toString() === wallet.publicKey?.toString()
        ) && lottery.status.statusNumeric !== 3; // Filter out completed/finalized lotteries
      });

      setAllLotteries(filteredLotteries);
    } catch (err) {
      console.error('Error fetching all lotteries:', err);
    } finally {
      setTableLoading(false);
    }
  }, [wallet.publicKey]);

  const processLottery = useCallback(async (lotteryId: string) => {
    try {
      console.log(`Processing lottery: ${lotteryId}`);
      setProcessingLotteryId(lotteryId);
      setError(null);
      await selectWinner(lotteryId);
      console.log(`Successfully processed lottery: ${lotteryId}`);
      await fetchLotteries();
    } catch (err) {
      console.error(`Error processing lottery ${lotteryId}:`, err);
      setError(`Failed to process lottery ${lotteryId}`);
    } finally {
      setProcessingLotteryId(null);
      console.log(`Completed processing for lottery: ${lotteryId}`);
    }
  }, [fetchLotteries]);

  const claimPrize = async (lotteryId: string, creator: PublicKey) => {
    try {
      console.log('Attempting to claim prize:', {
        lotteryId,
        winner: wallet.publicKey?.toString(),
        creator: creator.toString(),
        status: allLotteries.find(l => l.lotteryId === lotteryId)?.status
      });

      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error('Wallet not connected');
      }

      if (!isValidPublicKey(creator.toString())) {
        throw new Error('Invalid creator address');
      }

      const lottery = allLotteries.find(l => l.lotteryId === lotteryId);
      if (!lottery) {
        throw new Error('Lottery not found');
      }

      if (lottery.status.statusNumeric !== 2) { // 2 is WinnerSelected
        throw new Error(`Invalid lottery status: ${lottery.status.statusDisplay}`);
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

      const responseData = await response.json();

      if (!response.ok) {
        console.error('Claim prize error:', {
          status: response.status,
          statusText: response.statusText,
          data: responseData
        });

        throw new Error(
          responseData.error ||
          `Failed to claim prize: ${response.status} ${response.statusText}`
        );
      }

      if (!responseData.success || !responseData.transaction) {
        throw new Error('Invalid response from server');
      }

      // Convert the serialized transaction from base64 to Uint8Array
      const transactionBuffer = Buffer.from(responseData.transaction, 'base64');

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

      // After successful claim, update both lottery lists
      setAllLotteries(prevLotteries =>
        prevLotteries.map(lottery =>
          lottery.lotteryId === lotteryId
            ? { ...lottery, status: { statusNumeric: 3, statusDisplay: 'finalized' } }
            : lottery
        )
      );

      // Remove from the claimable lotteries list
      setLotteries(prevLotteries =>
        prevLotteries.filter(lottery => lottery.lotteryId !== lotteryId)
      );

      // Immediately refresh both lottery lists
      await Promise.all([
        fetchLotteries(),
        fetchAllLotteries()
      ]);

      console.log("Claimed prize successfully and refreshed tables");

      // Show success toast
      transactionToast(signature);

    } catch (err) {
      console.error(`Error claiming prize for lottery ${lotteryId}:`, err);
      let errorMessage = 'Failed to claim prize';

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }

      setError(errorMessage);

      // Show error in UI toast or alert
      transactionToast(`${errorMessage}`);
    } finally {
      setClaimingLotteryId(null);
    }
  };

  const checkAndProcessPendingLotteries = useCallback(async () => {
    try {
      const response = await fetch('/api/findEndedLotteries', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch lotteries');
      }

      const data = await response.json();
      console.log('Fetched lotteries:', data.lotteries);
      const pendingLotteries = data.lotteries?.filter(
        (lottery: Lottery) => lottery.status.statusNumeric === 1
      );

      console.log(`Found ${pendingLotteries?.length || 0} pending lotteries to process`);

      // Automatically process each pending lottery
      if (pendingLotteries && pendingLotteries.length > 0) {
        for (const lottery of pendingLotteries) {
          console.log(`Auto-processing lottery: ${lottery.lotteryId}`);
          await processLottery(lottery.lotteryId);
        }

        // Refresh the lottery lists after processing
        await Promise.all([
          fetchLotteries(),
          fetchAllLotteries()
        ]);
      }
    } catch (err) {
      console.error('Error checking/processing pending lotteries:', err);
    }
  }, [processLottery, fetchLotteries, fetchAllLotteries]);

  const processAllPendingLotteries = async () => {
    try {
      setLoading(true);
      setError(null);

      const pendingLotteries = allLotteries.filter(
        lottery => lottery.status.statusNumeric === 1
      );

      if (pendingLotteries.length === 0) {
        setError('No pending lotteries to process');
        return;
      }

      for (const lottery of pendingLotteries) {
        await processLottery(lottery.lotteryId);
      }

      // Refresh the lottery lists
      await Promise.all([
        fetchLotteries(),
        fetchAllLotteries()
      ]);

    } catch (err) {
      console.error('Error processing pending lotteries:', err);
      setError('Failed to process pending lotteries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    if (wallet.publicKey) {
      checkAndProcessPendingLotteries();
      intervalId = setInterval(checkAndProcessPendingLotteries, POLL_INTERVAL);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [wallet.publicKey, checkAndProcessPendingLotteries]);

  const renderTableRow = (lottery: Lottery) => {
    console.log('Rendering lottery row:', {
      lotteryId: lottery.lotteryId,
      status: lottery.status.statusNumeric,
      winner: lottery.winner,
      currentAddress: wallet.publicKey?.toString(),
      shouldShowClaim: lottery.status.statusNumeric === 2 &&
        lottery.winner?.toString() === wallet.publicKey?.toString(),
      addressMatch: lottery.winner?.toString() === wallet.publicKey?.toString()
    });

    const prizeAmountSol = lottery.totalPrize
      ? (Number.parseInt(lottery.totalPrize, 16) / anchor.web3.LAMPORTS_PER_SOL).toFixed(2)
      : '0.00';

    const isWinner = lottery.winner?.toString() === wallet.publicKey?.toString();

    return (
      <tr
        key={`table-${lottery.lotteryId}`}
        className={`hover:bg-base-300 ${isWinner ? 'bg-success bg-opacity-10' : ''}`}
      >
        <td className="whitespace-nowrap max-w-[4rem] truncate font-mono">
          {truncateAddress(lottery.lotteryId.toString())}
        </td>
        <td className="whitespace-nowrap max-w-[4rem] md:table-cell hidden">
          {lottery.participants?.length || 0}
        </td>
        <td className="whitespace-nowrap max-w-[8rem] truncate table-cell md:hidden font-mono">
          {lottery.winner
            ? truncateAddress(lottery.winner.toString())
            : 'Pending'}
        </td>
        <td className="whitespace-nowrap max-w-[6rem] truncate">
          {`${prizeAmountSol} SOL`}
        </td>
        <td className="whitespace-nowrap max-w-[8rem] truncate hidden md:table-cell font-mono">
          {lottery.creator
            ? truncateAddress(lottery.creator.toString())
            : ''}
        </td>
        <td className="whitespace-nowrap hidden md:table-cell font-mono">
          {lottery.winner
            ? truncateAddress(lottery.winner.toString())
            : 'Pending'}
        </td>
        <td className="whitespace-nowrap">
          {lottery.status.statusNumeric === 2 &&
            lottery.winner?.toString() === wallet.publicKey?.toString() ? (
            <div className="tooltip" data-tip={
              !lottery.creator ? "Missing creator address" :
                !isValidPublicKey(lottery.creator.toString()) ? "Invalid creator address" :
                  claimingLotteryId === lottery.lotteryId ? "Processing claim..." :
                    !wallet.publicKey ? "Please connect your wallet" :
                      Number(lottery.status.statusNumeric) === 3 ? "Prize already claimed" :
                    "Click to claim your prize"
            }>
              <button
                className={`btn btn-xs ${Number(lottery.status.statusNumeric) === 3 ? 'btn-disabled' : 'btn-primary'}`}
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
                  !wallet.publicKey ||
                  Number(lottery.status.statusNumeric) === 3
                }
              >
                {claimingLotteryId === lottery.lotteryId ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  Number(lottery.status.statusNumeric) === 3 ? 'Claimed' : 'Claim'
                )}
              </button>
            </div>
          ) : (
            <span className={`badge ${lottery.status.statusNumeric === 3
              ? 'badge-neutral'
              : lottery.status.statusNumeric === 2
                ? 'badge-success'
                : lottery.status.statusNumeric === 1
                  ? 'badge-warning'
                  : 'badge-info'
              }`}>
              {lottery.status.statusNumeric === 3 ? 'finalized'
                : lottery.status.statusNumeric === 2 ? 'completed'
                  : lottery.status.statusNumeric === 1 ? 'pending'
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
  }, [wallet.publicKey, fetchLotteries, fetchAllLotteries]);

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
        {allLotteries.some(lottery => lottery.status.statusNumeric === 1) && (
          <button
            className="btn btn-primary btn-sm"
            onClick={processAllPendingLotteries}
            disabled={loading || !!processingLotteryId}
          >
            {loading || processingLotteryId ? (
              <span className="loading loading-spinner loading-xs"></span>
            ) : (
              'Process Pending Lotteries'
            )}
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="text-xl font-semibold">My Lottery History</h3>
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
                    <th className="whitespace-nowrap md:table-cell hidden">Players</th>
                    <th className="whitespace-nowrap table-cell md:hidden">Winner</th>
                    <th className="whitespace-nowrap">Prize</th>
                    <th className="whitespace-nowrap hidden md:table-cell">Creator</th>
                    <th className="whitespace-nowrap hidden md:table-cell">Winner</th>
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
            <div className="alert">
              You haven&apos;t participated in any lotteries yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
