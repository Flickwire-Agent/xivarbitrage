import { Queue, QueueEvents } from "bullmq";
import { config } from "../config.js";

export const TARGET_REGIONS = ["North-America", "Europe", "Oceania"] as const;
export type TargetRegion = (typeof TARGET_REGIONS)[number];

export interface EvaluateItemJob {
  itemId: number;
  region?: TargetRegion;
}

export function getItemScanJobId(itemId: number, region?: TargetRegion): string {
  return region ? `evaluate-item-${itemId}-${region}` : `evaluate-item-${itemId}`;
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
          age: 300, // Keep completed jobs briefly for status without blocking the next scan cycle
        },
        removeOnFail: {
          age: 300, // job_history keeps diagnostics; stale IDs must not block the next scan
        },
      },
    });

    // Listen to queue events
    queueEvents = new QueueEvents("arbitrage-opportunities", {
      connection: {
        url: config.redisUrl,
      },
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
  prioritized: number;
  paused: number;
}> {
  const q = getQueue();
  const counts = await q.getJobCounts();
  const waiting = (counts.waiting ?? 0) + (counts.wait ?? 0);

  return {
    pending: waiting + (counts.prioritized ?? 0),
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
    prioritized: counts.prioritized ?? 0,
    paused: counts.paused ?? 0,
  };
}

export async function clearFailedScanJobs(): Promise<number> {
  const removed = await getQueue().clean(0, 100_000, "failed");
  return removed.length;
}
