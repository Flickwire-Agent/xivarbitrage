import { Queue, QueueEvents } from "bullmq";
import { config } from "../config.js";

export interface EvaluateItemJob {
  itemId: number;
  region: string;
}

let queue: Queue<EvaluateItemJob> | null = null;
let queueEvents: QueueEvents | null = null;

export function getQueue(): Queue<EvaluateItemJob> {
  if (!queue) {
    queue = new Queue<EvaluateItemJob>("arbitrage-opportunities", {
      connection: {
        url: config.redisUrl,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: {
          age: 3600, // Remove completed jobs after 1 hour
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours for debugging
        },
      },
    });

    // Listen to queue events
    queueEvents = new QueueEvents("arbitrage-opportunities", {
      connection: {
        url: config.redisUrl,
      },
    });

    queueEvents.on("completed", ({ jobId }) => {
      console.log(`[BullMQ] Job ${jobId} completed`);
    });

    queueEvents.on("failed", ({ jobId, failedReason }) => {
      console.error(`[BullMQ] Job ${jobId} failed: ${failedReason}`);
    });

    queueEvents.on("stalled", ({ jobId }) => {
      console.warn(`[BullMQ] Job ${jobId} stalled`);
    });
  }

  return queue;
}

export async function closeQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }

  if (queue) {
    await queue.close();
    queue = null;
  }
}

export async function getQueueStats(): Promise<{
  pending: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}> {
  const q = getQueue();
  const counts = await q.getJobCounts();

  return {
    pending: counts.wait ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
    paused: counts.paused ?? 0,
  };
}
