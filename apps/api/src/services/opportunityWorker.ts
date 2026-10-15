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

function recordWorkerAttempt(
  completed: boolean,
  processedRegions: number,
  skippedFreshRegions: number,
  duration: number,
): void {
  if (completed) workerMetrics.completedJobs++;
  else workerMetrics.failedJobs++;
  workerMetrics.processedRegions += processedRegions;
  workerMetrics.skippedFreshRegions += skippedFreshRegions;
  workerMetrics.totalDuration += duration;
  workerMetrics.maxDuration = Math.max(workerMetrics.maxDuration, duration);

  const now = Date.now();
  if (now - workerMetrics.loggedAt < WORKER_METRIC_LOG_INTERVAL_MS) {
    return;
  }

  const attempts = workerMetrics.completedJobs + workerMetrics.failedJobs;
  const avgDuration = Math.round(workerMetrics.totalDuration / attempts);
  console.log(
    `[Worker] Metrics attempts=${attempts} jobs=${workerMetrics.completedJobs} failed=${workerMetrics.failedJobs} regions=${workerMetrics.processedRegions} skippedFresh=${workerMetrics.skippedFreshRegions} avgDuration=${avgDuration}ms maxDuration=${workerMetrics.maxDuration}ms`,
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
      let completed = false;
      let activeRegion: TargetRegion | undefined = region;

      try {
        const regionsToScan = region ? [region] : TARGET_REGIONS;

        for (const targetRegion of regionsToScan) {
          activeRegion = targetRegion;
          const freshData = await marketSnapshotStore.getFresh(targetRegion, itemId);
          let status: "completed" | "skipped_fresh";
          if (freshData) {
            await recordRegionScan(itemId, targetRegion, "skipped_fresh");
            status = "skipped_fresh";
            skippedFreshRegions++;
          } else {
            const data = await universalis.getCurrentData(targetRegion, itemId);
            // Persist sales before publishing a fresh snapshot: a failed sales write
            // must not cause the next attempt to skip unfinished ingestion.
            await marketSnapshotStore.storeSales(itemId, data);
            await marketSnapshotStore.upsert(targetRegion, itemId, data);
            await recordRegionScan(itemId, targetRegion, "completed");
            status = "completed";
            processedRegions++;
          }
          // Record each region immediately so a later legacy multi-region failure
          // cannot discard successful history. Retries reuse those fresh snapshots.
          await pool.query(
            `INSERT INTO job_history (job_id, item_id, region, status, completed_at, created_at)
             VALUES ($1, $2, $3, $4, now(), now())`,
            [job.id, itemId, targetRegion, status],
          );
        }

        const duration = Date.now() - startTime;
        completed = true;

        return {
          processed: processedRegions + skippedFreshRegions > 0,
          processedRegions,
          skippedFreshRegions,
          duration,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        try {
          await pool.query(
            `INSERT INTO job_history (job_id, item_id, region, status, error_message, created_at)
             VALUES ($1, $2, $3, $4, $5, now())`,
            [job.id, itemId, activeRegion, "failed", errorMsg],
          );
        } catch (historyError) {
          console.error(`[Worker] Could not record failed attempt item_id=${itemId}`, historyError);
        }
        console.error(`[Worker] Failed item_id=${itemId} region=${activeRegion} error=${errorMsg}`);
        throw error;
      } finally {
        recordWorkerAttempt(
          completed,
          processedRegions,
          skippedFreshRegions,
          Date.now() - startTime,
        );
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
    console.error(
      `[Worker] Job ${job?.id} attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 1} failed: ${err.message}`,
    );
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
