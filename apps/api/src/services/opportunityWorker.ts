import { Worker } from "bullmq";
import { config } from "../config.js";
import { universalis } from "./universalis.js";
import { marketSnapshotStore } from "./marketSnapshotStore.js";
import { pool } from "../db/pool.js";
import { TARGET_REGIONS, type EvaluateItemJob } from "./jobQueue.js";

let worker: Worker<EvaluateItemJob> | null = null;

const WORKER_METRIC_LOG_INTERVAL_MS = 60000;

const workerMetrics = {
  completedJobs: 0,
  failedJobs: 0,
  processedRegions: 0,
  totalDuration: 0,
  maxDuration: 0,
  loggedAt: Date.now(),
};

function recordWorkerSuccess(processedRegions: number, duration: number): void {
  workerMetrics.completedJobs++;
  workerMetrics.processedRegions += processedRegions;
  workerMetrics.totalDuration += duration;
  workerMetrics.maxDuration = Math.max(workerMetrics.maxDuration, duration);

  const now = Date.now();
  if (now - workerMetrics.loggedAt < WORKER_METRIC_LOG_INTERVAL_MS) {
    return;
  }

  const avgDuration = Math.round(workerMetrics.totalDuration / workerMetrics.completedJobs);
  console.log(
    `[Worker] Metrics jobs=${workerMetrics.completedJobs} failed=${workerMetrics.failedJobs} regions=${workerMetrics.processedRegions} avgDuration=${avgDuration}ms maxDuration=${workerMetrics.maxDuration}ms`,
  );

  workerMetrics.completedJobs = 0;
  workerMetrics.failedJobs = 0;
  workerMetrics.processedRegions = 0;
  workerMetrics.totalDuration = 0;
  workerMetrics.maxDuration = 0;
  workerMetrics.loggedAt = now;
}

export async function initializeWorker(): Promise<void> {
  if (!config.databaseUrl || !config.redisUrl) {
    console.warn("Database URL or Redis URL not configured. Worker will not be initialized.");
    return;
  }

  worker = new Worker<EvaluateItemJob>(
    "arbitrage-opportunities",
    async (job) => {
      const { itemId } = job.data;
      const startTime = Date.now();
      let processedRegions = 0;

      try {
        for (const region of TARGET_REGIONS) {
          const data = await universalis.getCurrentData(region, itemId);

          if (!data) {
            continue;
          }

          await marketSnapshotStore.upsert(region, itemId, data);

          await marketSnapshotStore.storeSales(itemId, data);

          await pool.query(
            `INSERT INTO job_history (job_id, item_id, region, status, completed_at, created_at)
             VALUES ($1, $2, $3, $4, now(), now())`,
            [job.id, itemId, region, "completed"],
          );

          processedRegions++;
        }

        if (processedRegions > 0) {
          await pool.query("UPDATE marketable_items SET last_scanned = now() WHERE item_id = $1", [
            itemId,
          ]);
        }

        const duration = Date.now() - startTime;
        recordWorkerSuccess(processedRegions, duration);

        return { processed: processedRegions > 0, processedRegions, duration };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        workerMetrics.failedJobs++;

        await pool.query(
          `INSERT INTO job_history (job_id, item_id, region, status, error_message, created_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [job.id, itemId, "all", "failed", errorMsg],
        );

        console.error(`[Worker] Failed item_id=${itemId} error=${errorMsg}`);
        throw error;
      }
    },
    {
      connection: {
        url: config.redisUrl,
      },
      concurrency: config.jobQueueConcurrency,
      maxStalledCount: 3,
      stalledInterval: 30000,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed after retries: ${err.message}`);
  });

  worker.on("error", (err) => {
    console.error(`[Worker] Worker error: ${err.message}`);
  });

  console.log(`[Worker] Initialized with concurrency=${config.jobQueueConcurrency}`);
}

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

export function getWorker(): Worker<EvaluateItemJob> | null {
  return worker;
}
