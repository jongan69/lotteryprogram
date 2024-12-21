import './init';  // Import the init file to ensure task processing is started
import { taskQueue } from '../taskQueue';
import { NextRequest, NextResponse } from "next/server";

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
        const debug = searchParams.get('debug');
        const force = searchParams.get('force');
        const reset = searchParams.get('reset');

        if (!taskId) {
            return NextResponse.json(
                { error: "Missing 'taskId' in query parameters" },
                { status: 400 }
            );
        }

        if (debug === 'true') {
            const debugInfo = await taskQueue.debugTask(taskId);
            return NextResponse.json(debugInfo);
        }

        if (force === 'true') {
            await taskQueue.forceProcessTask(taskId);
            return NextResponse.json({ message: "Task processing forced" });
        }

        if (reset === 'true') {
            await taskQueue.resetTask(taskId);
            return NextResponse.json({ message: "Task reset to pending" });
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
        console.error("Error in task route:", error);
        return NextResponse.json(
            { error: (error as Error).message },
            { status: 500 }
        );
    }
}
