import { MongoClient, ObjectId } from "mongodb";
import { NextApiRequest, NextApiResponse } from "next";
const MONGODB_URI = process.env.MONGODB_URI!;
const client = new MongoClient(MONGODB_URI);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "POST") {
        // Enqueue a new task
        return enqueueTask(req, res);
    } else if (req.method === "GET") {
        // Check task status
        return getTaskStatus(req, res);
    } else {
        res.setHeader("Allow", ["POST", "GET"]);
        return res.status(405).json({ error: "Method not allowed" });
    }
}

// Enqueue a new task
async function enqueueTask(req: NextApiRequest, res: NextApiResponse) {
    try {
        const { action, params } = req.body;

        if (!action || !params) {
            return res.status(400).json({ error: "Missing 'action' or 'params' in request body" });
        }

        await client.connect();
        const db = client.db("taskQueue");
        const tasks = db.collection("tasks");

        const task = {
            action,
            params,
            status: "pending",
            result: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const result = await tasks.insertOne(task);
        res.status(201).json({ success: true, taskId: result.insertedId });
    } catch (error) {
        console.error("Error enqueueing task:", error);
        res.status(500).json({ error: "Failed to enqueue task" });
    } finally {
        await client.close();
    }
}

// Get the status of a specific task
async function getTaskStatus(req: NextApiRequest, res: NextApiResponse) {
    try {
        const taskId = Array.isArray(req.query.taskId) ? req.query.taskId[0] : req.query.taskId;

        if (!taskId) {
            return res.status(400).json({ error: "Missing 'taskId' in query parameters" });
        }

        await client.connect();
        const db = client.db("taskQueue");
        const tasks = db.collection("tasks");

        const task = await tasks.findOne({ _id: new ObjectId(taskId) });

        if (!task) {
            return res.status(404).json({ error: "Task not found" });
        }

        res.status(200).json({ success: true, task });
    } catch (error) {
        console.error("Error fetching task status:", error);
        res.status(500).json({ error: "Failed to fetch task status" });
    } finally {
        await client.close();
    }
}
