import { PublicKey } from "@solana/web3.js";

export const computeUnitPrice = 100_000_000;
export const computeUnitLimitMultiple = 2;
export const COMMITMENT = "processed";
export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID
    ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID)
    : null;
export const RPC_URL = process.env.RPC_URL!;
export const ADMIN_KEY = process.env.ADMIN_KEY!;