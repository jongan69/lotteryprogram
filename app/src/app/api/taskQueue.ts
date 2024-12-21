import { MongoClient, ObjectId } from "mongodb";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram, Commitment } from "@solana/web3.js";
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
    commitment: "processed" as Commitment,
    skipPreflight: true,
    maxRetries: 0,
};

let clientPromise: Promise<MongoClient>;
let isProcessing = false;
let processingTimeout: NodeJS.Timeout | null = null;

async function getMongoClient() {
    if (!clientPromise) {
        clientPromise = MongoClient.connect(MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 1,
            maxIdleTimeMS: 120000,
            connectTimeoutMS: 30000,
            socketTimeoutMS: 360000,
            serverSelectionTimeoutMS: 30000,
            retryWrites: true,
            retryReads: true,
            monitorCommands: true,
            heartbeatFrequencyMS: 10000,
            minHeartbeatFrequencyMS: 500
        });
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

async function setupQueue(program: anchor.Program): Promise<PublicKey> {
    const queueAccount = await sb.getDefaultQueue(
        program.provider.connection.rpcEndpoint
    );
    console.log("Queue account found:", queueAccount.pubkey.toString());
    try {
        console.log("Loading queue data...");
        await queueAccount.loadData();
        console.log("Queue data loaded successfully");
    } catch (err) {
        console.error("Error loading queue data:", err);
        console.error("Queue not found, ensure you are using devnet in your env");
        throw new Error("Queue setup failed");
    }
    return queueAccount.pubkey;
}

async function processTask(task: Task) {
    console.log('=== Starting processTask ===');
    console.log('Task details:', {
        id: task._id?.toString(),
        action: task.action,
        params: task.params
    });

    const { action, params, _id } = task;
    if (!_id) throw new Error("Task ID is required");

    try {
        // Setup wallet exactly like selectWinner
        const adminKeypair = Keypair.fromSecretKey(bs58.decode(ADMIN_KEY));
        const connection = new Connection(RPC_URL, COMMITMENT);
        
        const wallet = {
            publicKey: adminKeypair.publicKey,
            signTransaction: (tx: any) => Promise.resolve(tx.sign([adminKeypair])),
            signAllTransactions: (txs: any[]) => Promise.all(txs.map(tx => tx.sign([adminKeypair]))),
        };

        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: COMMITMENT
        });

        // Initialize lottery program
        const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider);
        if (!idl) throw new Error("IDL not found for program");
        let lotteryProgram: any;
        try {
            lotteryProgram = new anchor.Program(idl, provider);
        } catch (error) {
            console.error("Error initializing lottery program:", error);
            throw new Error("Failed to initialize lottery program");
        }

        // Get lottery account
        const [lotteryAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from("lottery"), Buffer.from(params.lotteryId)],
            lotteryProgram.programId
        );

        // Check lottery state
        const lotteryState = await lotteryProgram.account.lotteryState.fetch(lotteryAccount);
        if (!lotteryState.participants || lotteryState.participants.length === 0) {
            throw new Error("No participants found in the lottery");
        }

        // Initialize Switchboard
        const sbProgramId = await sb.getProgramId(connection);
        const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
        if (!sbIdl) throw new Error("IDL not found for Switchboard program");
        const sbProgram = new anchor.Program(sbIdl, provider);
        const queue = await setupQueue(sbProgram);

        // Create randomness account
        const rngKeypair = Keypair.generate();
        const [randomnessAccount, createRandomnessIx] = await sb.Randomness.create(sbProgram, rngKeypair, queue);

        // Send create randomness transaction
        const createRandomnessTx = await sb.asV0Tx({
            connection: sbProgram.provider.connection,
            ixs: [createRandomnessIx],
            payer: adminKeypair.publicKey,
            signers: [adminKeypair, rngKeypair],
        });
        const randomnessSig = await connection.sendTransaction(createRandomnessTx, txOpts);
        await confirmTransaction(connection, randomnessSig);

        // Commit randomness
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

        // Reveal and select winner
        const revealIx = await randomnessAccount.revealIx();
        const selectWinnerIx = await createSelectWinnerInstruction(
            lotteryProgram,
            lotteryAccount,
            randomnessAccount.pubkey,
            params.lotteryId
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

        return {
            randomnessSig,
            commitSig,
            revealSig,
            lotteryId: params.lotteryId
        };
    } catch (error) {
        console.error('ProcessTask error:', error);
        throw error;
    }
}

async function processQueue() {
    const client = await getMongoClient();
    try {
        const db = client.db("taskQueue");
        const tasks = db.collection("tasks");

        // Find a pending task
        const pendingTask = await tasks.findOne({ status: "pending" });
        
        if (!pendingTask) {
            console.log("No pending tasks found in queue");
            return;
        }

        console.log(`[QUEUE] Found pending task ${pendingTask._id.toString()} for lottery ${pendingTask.params.lotteryId}`);

        // Try to claim it
        const result = await tasks.findOneAndUpdate(
            { 
                _id: pendingTask._id,
                status: "pending"
            },
            { 
                $set: { 
                    status: "in-progress", 
                    updatedAt: new Date(),
                    processingStartedAt: new Date()
                }
            },
            { returnDocument: "after" }
        );

        if (!result?.value) {
            console.log(`[QUEUE] Failed to claim task ${pendingTask._id.toString()}`);
            return;
        }

        const taskValue = result.value;
        console.log(`[QUEUE] Successfully claimed and starting to process task ${taskValue._id.toString()}`);

        try {
            console.log(`[QUEUE] Executing processTask for ${taskValue._id.toString()}`);
            const processResult = await processTask(taskValue);
            console.log(`[QUEUE] Task ${taskValue._id.toString()} completed with result:`, processResult);

            await tasks.updateOne(
                { _id: taskValue._id },
                { 
                    $set: { 
                        status: "completed", 
                        result: processResult, 
                        updatedAt: new Date(),
                        completedAt: new Date(),
                        processingStartedAt: null
                    } 
                }
            );
            console.log(`[QUEUE] Task ${taskValue._id.toString()} marked as completed in database`);
        } catch (error) {
            console.error(`[QUEUE] Task ${taskValue._id.toString()} failed with error:`, error);
            await tasks.updateOne(
                { _id: taskValue._id },
                { 
                    $set: { 
                        status: "failed", 
                        error: (error as Error).message,
                        errorStack: (error as Error).stack,
                        updatedAt: new Date(),
                        failedAt: new Date(),
                        processingStartedAt: null
                    } 
                }
            );
            console.log(`[QUEUE] Task ${taskValue._id.toString()} marked as failed in database`);
        }
    } catch (error) {
        console.error("[QUEUE] Critical error in queue processing:", error);
    }
}

async function startProcessing() {
    if (isProcessing) {
        console.log("[QUEUE] Already processing, skipping");
        return;
    }
    
    console.log("[QUEUE] Starting processing cycle");
    isProcessing = true;
    try {
        await processQueue();
    } finally {
        isProcessing = false;
        if (processingTimeout) {
            clearTimeout(processingTimeout);
        }
        processingTimeout = setTimeout(startProcessing, 100);
        console.log("[QUEUE] Processing cycle complete, scheduled next check in 100ms");
    }
}

export interface Task {
    _id?: ObjectId;
    action: string;
    params: any;
    status: "pending" | "in-progress" | "completed" | "failed";
    result: any;
    error: string | null;
    errorStack: string | null;
    createdAt: Date;
    updatedAt: Date;
    processingStartedAt: Date | null;
    completedAt: Date | null;
    failedAt: Date | null;
    processingAttempts?: number;
    walletAddress?: string;
    logs: Array<{
        timestamp: Date;
        message: string;
        type: 'info' | 'error' | 'success';
        data?: any;
    }>;
}

async function updateTaskLog(
    tasks: any,
    taskId: ObjectId,
    message: string,
    type: 'info' | 'error' | 'success' = 'info',
    data?: any
) {
    const logEntry = {
        timestamp: new Date(),
        message,
        type,
        ...(data ? { data } : {})
    };

    await tasks.updateOne(
        { _id: taskId },
        { 
            $push: { logs: logEntry },
            $set: { updatedAt: new Date() }
        }
    );
    return logEntry;
}

export const taskQueue = {
    async enqueue(action: string, params: any): Promise<ObjectId> {
        console.log(`Enqueuing task with action: ${action} and params:`, params);
        const { lotteryId, address } = params;
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");

        // Check for existing task
        const existingTask = await tasks.findOne({
            walletAddress: address,
            'params.lotteryId': lotteryId,
            status: { $in: ["pending", "in-progress"] }
        });

        if (existingTask) {
            console.log(`Task already exists for wallet ${address} and lottery ${lotteryId}`);
            throw new Error(`A task is already in progress for lottery ${lotteryId}`);
        }

        // Create new task
        const task: Task = {
            action,
            params,
            status: "pending",
            result: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            walletAddress: address,
            logs: [],
            error: null,
            errorStack: null,
            processingStartedAt: null,
            completedAt: null,
            failedAt: null
        };

        const result = await tasks.insertOne(task);
        const taskId = result.insertedId;
        console.log(`Task created:`, taskId.toString());

        // Process immediately
        try {
            console.log("Processing task immediately");
            const processResult = await processTask(task);
            await tasks.updateOne(
                { _id: taskId },
                { 
                    $set: { 
                        status: "completed", 
                        result: processResult, 
                        updatedAt: new Date(),
                        completedAt: new Date()
                    } 
                }
            );
            console.log("Task completed successfully");
        } catch (error) {
            console.error("Task processing failed:", error);
            await tasks.updateOne(
                { _id: taskId },
                { 
                    $set: { 
                        status: "failed", 
                        error: (error as Error).message,
                        errorStack: (error as Error).stack,
                        updatedAt: new Date(),
                        failedAt: new Date()
                    } 
                }
            );
            throw error;
        }

        return taskId;
    },

    async getStatus(taskId: string): Promise<Task | null> {
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");
        return await tasks.findOne({ _id: new ObjectId(taskId) });
    },

    async getPendingTasks(): Promise<Task[]> {
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");
        return await tasks.find({ status: "pending" }).toArray();
    },

    startProcessing,
    
    stopProcessing() {
        if (processingTimeout) {
            clearTimeout(processingTimeout);
            processingTimeout = null;
        }
        isProcessing = false;
    },

    async debugTask(taskId: string): Promise<any> {
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");
        
        const task = await tasks.findOne({ _id: new ObjectId(taskId) });
        if (!task) {
            return { error: "Task not found" };
        }

        return {
            taskId: task._id.toString(),
            status: task.status,
            action: task.action,
            params: task.params,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            processingStartedAt: task.processingStartedAt,
            completedAt: task.completedAt,
            failedAt: task.failedAt,
            error: task.error,
            logs: task.logs,
            isProcessing,
            hasTimeout: !!processingTimeout
        };
    },

    async forceProcessTask(taskId: string): Promise<void> {
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");
        
        const task = await tasks.findOne({ _id: new ObjectId(taskId) });
        if (!task) {
            throw new Error("Task not found");
        }

        console.log("Force processing task:", task._id.toString());
        
        try {
            const result = await processTask(task);
            await tasks.updateOne(
                { _id: task._id },
                { 
                    $set: { 
                        status: "completed", 
                        result, 
                        updatedAt: new Date(),
                        completedAt: new Date(),
                        processingStartedAt: null
                    } 
                }
            );
        } catch (error) {
            console.error("Force processing failed:", error);
            throw error;
        }
    },

    async resetTask(taskId: string): Promise<void> {
        const client = await getMongoClient();
        const db = client.db("taskQueue");
        const tasks = db.collection<Task>("tasks");
        
        await tasks.updateOne(
            { _id: new ObjectId(taskId) },
            { 
                $set: { 
                    status: "pending",
                    processingStartedAt: null,
                    error: null,
                    errorStack: null,
                    updatedAt: new Date()
                } 
            }
        );
    }
};
