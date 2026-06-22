import { Worker } from "bullmq";
import { config } from "../config.js";
import { universalis } from "./universalis.js";
import { marketSnapshotStore } from "./marketSnapshotStore.js";
import { pool } from "../db/pool.js";
import { TARGET_REGIONS, type EvaluateItemJob, type TargetRegion } from "./jobQueue.js";

let worker: Worker<EvaluateItemJob> | null = null;

const WORKER_METRIC_LOG_INTERVAL_MS = 60000;

const workerMetrics = {
  completedJobs: 0,
  failedJobs: 0,
  processedRegions: 0,
  skippedFreshRegions: 0,
  totalDuration: 0,
  maxDuration: 0,
  loggedAt: Date.now(),
};

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function recordRegionScan(
  itemId: number,
  region: TargetRegion,
  status: "completed" | "skipped_fresh",
): Promise<void> {
  await pool.query(
    `INSERT INTO item_region_scan_state
       (item_id, region, last_scanned, next_scan_at, status, updated_at)
     VALUES ($1, $2, now(), $3, $4, now())
     ON CONFLICT (item_id, region) DO UPDATE SET
       last_scanned = EXCLUDED.last_scanned,
       next_scan_at = EXCLUDED.next_scan_at,
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at`,
    [itemId, region, new Date(Date.now() + SCAN_INTERVAL_MS), status],
  );
}

function recordWorkerSuccess(
  processedRegions: number,
  skippedFreshRegions: number,
  duration: number,
): void {
  workerMetrics.completedJobs++;
  workerMetrics.processedRegions += processedRegions;
  workerMetrics.skippedFreshRegions += skippedFreshRegions;
  workerMetrics.totalDuration += duration;
  workerMetrics.maxDuration = Math.max(workerMetrics.maxDuration, duration);

  const now = Date.now();
  if (now - workerMetrics.loggedAt < WORKER_METRIC_LOG_INTERVAL_MS) {
    return;
  }

  const avgDuration = Math.round(workerMetrics.totalDuration / workerMetrics.completedJobs);
  console.log(
    `[Worker] Metrics jobs=${workerMetrics.completedJobs} failed=${workerMetrics.failedJobs} regions=${workerMetrics.processedRegions} skippedFresh=${workerMetrics.skippedFreshRegions} avgDuration=${avgDuration}ms maxDuration=${workerMetrics.maxDuration}ms`,
  );

  workerMetrics.completedJobs = 0;
  workerMetrics.failedJobs = 0;
  workerMetrics.processedRegions = 0;
  workerMetrics.skippedFreshRegions = 0;
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
      const { itemId, region } = job.data;
      const startTime = Date.now();
      let processedRegions = 0;
      let skippedFreshRegions = 0;

      try {
        const regionsToScan = region ? [region] : TARGET_REGIONS;

        for (const targetRegion of regionsToScan) {
          const freshData = await marketSnapshotStore.getFresh(targetRegion, itemId);

          if (freshData) {
            await pool.query(
              `INSERT INTO job_history (job_id, item_id, region, status, completed_at, created_at)
               VALUES ($1, $2, $3, $4, now(), now())`,
              [job.id, itemId, targetRegion, "skipped_fresh"],
            );

            await recordRegionScan(itemId, targetRegion, "skipped_fresh");

            skippedFreshRegions++;
            continue;
          }

          const data = await universalis.getCurrentData(targetRegion, itemId);

          if (!data) {
            continue;
          }

          await marketSnapshotStore.upsert(targetRegion, itemId, data);

          await marketSnapshotStore.storeSales(itemId, data);

          await pool.query(
            `INSERT INTO job_history (job_id, item_id, region, status, completed_at, created_at)
             VALUES ($1, $2, $3, $4, now(), now())`,
            [job.id, itemId, targetRegion, "completed"],
          );

          await recordRegionScan(itemId, targetRegion, "completed");

          processedRegions++;
        }

        const duration = Date.now() - startTime;
        recordWorkerSuccess(processedRegions, skippedFreshRegions, duration);

        return {
          processed: processedRegions + skippedFreshRegions > 0,
          processedRegions,
          skippedFreshRegions,
          duration,
        };
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
