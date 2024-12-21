import { MongoClient, ObjectId } from "mongodb";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import bs58 from "bs58";

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!);
const RPC_URL = process.env.RPC_URL!;
const ADMIN_KEY = process.env.ADMIN_KEY!;
const MONGODB_URI = process.env.MONGODB_URI!;
const COMMITMENT = "processed";
const computeUnitPrice = 100_000_000;
const computeUnitLimitMultiple = 2;

const txOpts = {
    commitment: "processed",
    skipPreflight: true,
    maxRetries: 0,
};

let clientPromise: Promise<MongoClient>;

async function getMongoClient() {
    if (!clientPromise) {
        clientPromise = MongoClient.connect(MONGODB_URI);
    }
    return clientPromise;
}

async function confirmTransaction(connection: Connection, signature: string) {
    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
        const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        if (status?.value?.confirmationStatus === "confirmed") {
            console.log(`Transaction confirmed: ${signature}`);
            return;
        }
        console.log(`Waiting for confirmation (attempt ${attempts + 1}/${maxAttempts})...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;
    }
    throw new Error(`Transaction not confirmed: ${signature}`);
}

async function createSelectWinnerInstruction(lotteryProgram: anchor.Program<anchor.Idl>, lotteryAccount: anchor.web3.PublicKey, randomnessAccount: anchor.web3.PublicKey, lotteryId: any) {
    return await lotteryProgram.methods
        .selectWinner(lotteryId)
        .accounts({
            lottery: lotteryAccount,
            randomnessAccountData: randomnessAccount,
            systemProgram: SystemProgram.programId,
        })
        .instruction();
}

async function setupQueue(program: anchor.Program<anchor.Idl>) {
    const queueAccount = await sb.getDefaultQueue(program.provider.connection.rpcEndpoint);
    console.log("Queue account found:", queueAccount.pubkey.toString());
    try {
        await queueAccount.loadData();
    } catch (err) {
        console.error("Error loading queue data:", err);
        throw new Error("Queue setup failed");
    }
    return queueAccount.pubkey;
}

async function processTask(task: Task) {
    const { action, params } = task;

    if (action !== "selectWinner") {
        throw new Error(`Unsupported task action: ${action}`);
    }

    const { lotteryId } = params;
    if (!lotteryId) {
        throw new Error("Lottery ID is required");
    }

    const adminKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_KEY));
    const connection = new Connection(RPC_URL, COMMITMENT);

    const wallet = {
        publicKey: adminKeypair.publicKey,
        signTransaction: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(tx: T): Promise<T> => {
          if (tx instanceof anchor.web3.Transaction) {
            tx.partialSign(adminKeypair);
          }
          return tx;
        },
        signAllTransactions: async <T extends anchor.web3.Transaction | anchor.web3.VersionedTransaction>(txs: T[]): Promise<T[]> => {
          txs.forEach(tx => {
            if (tx instanceof anchor.web3.Transaction) {
              tx.partialSign(adminKeypair);
            }
          });
          return txs;
        },
      };
    const provider = new anchor.AnchorProvider(connection, wallet, { commitment: COMMITMENT });

    let lotteryProgram: any;
    try {
        const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
        if (!idl) {
            throw new Error("IDL not found for program");
        }
        lotteryProgram = new anchor.Program(idl, provider);
    } catch (error) {
        console.error("Error initializing lottery program:", error);
        throw error;
    }

    const [lotteryAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("lottery"), Buffer.from(lotteryId)],
        lotteryProgram.programId
    );

    const lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
    if (!lotteryState.participants || lotteryState.participants.length === 0) {
        throw new Error("No participants found in the lottery");
    }

    const rngKeypair = Keypair.generate();
    const sbProgramId = await sb.getProgramId(connection);
    const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
    if (!sbIdl) throw new Error("IDL not found for Switchboard program");

    const sbProgram = new anchor.Program(sbIdl, provider);
    const queue = await setupQueue(sbProgram);

    const [randomnessAccount, createRandomnessIx] = await sb.Randomness.create(sbProgram, rngKeypair, queue);

    const createRandomnessTx = await sb.asV0Tx({
        connection: sbProgram.provider.connection,
        ixs: [createRandomnessIx],
        payer: adminKeypair.publicKey,
        signers: [adminKeypair, rngKeypair],
    });
    const randomnessSig = await connection.sendTransaction(createRandomnessTx, txOpts);
    await confirmTransaction(connection, randomnessSig);

    const commitIx = await randomnessAccount.commitIx(queue);
    const commitTx = await sb.asV0Tx({
        connection,
        ixs: [commitIx],
        payer: adminKeypair.publicKey,
        signers: [adminKeypair],
        computeUnitPrice,
        computeUnitLimitMultiple,
    });
    const commitSig = await connection.sendTransaction(commitTx, txOpts);
    await confirmTransaction(connection, commitSig);

    const revealIx = await randomnessAccount.revealIx();
    const selectWinnerIx = await createSelectWinnerInstruction(
        lotteryProgram,
        lotteryAccount,
        randomnessAccount.pubkey,
        lotteryId
    );

    const revealTx = await sb.asV0Tx({
        connection,
        ixs: [revealIx, selectWinnerIx],
        payer: adminKeypair.publicKey,
        signers: [adminKeypair],
        computeUnitPrice,
        computeUnitLimitMultiple,
    });
    const revealSig = await connection.sendTransaction(revealTx, txOpts);
    await confirmTransaction(connection, revealSig);

    console.log(`Winner selected successfully for lottery ID ${lotteryId}`);
    return {
        randomnessSig,
        commitSig,
        revealSig,
        lotteryId
    };
}

async function processQueue() {
    const client = await getMongoClient();
    try {
        const db = client.db("taskQueue");
        const tasks = db.collection("tasks");

        const task = await tasks.findOneAndUpdate(
            { status: "pending" },
            { $set: { status: "in-progress", updatedAt: new Date() } },
            { returnDocument: "after" }
        );

        if (!task?.value) {
            console.log("No pending tasks.");
            return;
        }

        const taskValue = task.value;

        console.log("Processing task:", taskValue);
        try {
            const result = await processTask(taskValue);
            await tasks.updateOne(
                { _id: taskValue._id },
                { $set: { status: "completed", result, updatedAt: new Date() } }
            );
        } catch (error) {
            console.error("Task failed:", error);
            await tasks.updateOne(
                { _id: taskValue._id },
                { $set: { status: "failed", result: (error as Error).message, updatedAt: new Date() } }
            );
        }
    } catch (error: any) {
        console.error("Error processing queue:", error);
    }
}

export interface Task {
    _id?: ObjectId;
    action: string;
    params: any;
    status: "pending" | "processing" | "completed" | "failed";
    result: any;
    createdAt: Date;
    updatedAt: Date;
}

export const taskQueue = {
    async enqueue(action: string, params: any): Promise<ObjectId> {
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");

        const task: Task = {
            action,
            params,
            status: "pending",
            result: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await tasks.insertOne(task);
        return result.insertedId;
    },

    async getStatus(taskId: string): Promise<Task | null> {
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");
        return await tasks.findOne({ _id: new ObjectId(taskId) });
    }
};

setInterval(processQueue, 5000);
