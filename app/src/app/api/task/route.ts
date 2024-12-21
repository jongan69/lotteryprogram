import { NextRequest, NextResponse } from "next/server";
import { taskQueue } from "../taskQueue";

// POST handler for enqueueing new tasks
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action, params } = body;

        if (!action || !params) {
            return NextResponse.json(
                { error: "Missing 'action' or 'params' in request body" },
                { status: 400 }
            );
        }

        const taskId = await taskQueue.enqueue(action, params);
        return NextResponse.json(
            { success: true, taskId },
            { status: 201 }
        );
    } catch (error) {
        console.error("Error enqueueing task:", error);
        return NextResponse.json(
            { error: "Failed to enqueue task" },
            { status: 500 }
        );
    }
}

// GET handler for checking task status
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const taskId = searchParams.get('taskId');

        if (!taskId) {
            return NextResponse.json(
                { error: "Missing 'taskId' in query parameters" },
                { status: 400 }
            );
        }

        const task = await taskQueue.getStatus(taskId);

        if (!task) {
            return NextResponse.json(
                { error: "Task not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({ success: true, task });
    } catch (error) {
        console.error("Error fetching task status:", error);
        return NextResponse.json(
            { error: "Failed to fetch task status" },
            { status: 500 }
        );
    }
}
