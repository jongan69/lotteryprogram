import { taskQueue } from '../taskQueue';

// Ensure task processing is started when the API routes are loaded
taskQueue.startProcessing();

export default function init() {
    // This function exists just to ensure the file is executed
    return null;
} 