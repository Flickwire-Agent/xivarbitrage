import { Worker } from "bullmq";
import { config } from "../config.js";
import { universalis } from "./universalis.js";
import { marketSnapshotStore } from "./marketSnapshotStore.js";
import { pool } from "../db/pool.js";
import { TARGET_REGIONS, type EvaluateItemJob } from "./jobQueue.js";

let worker: Worker<EvaluateItemJob> | null = null;

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
      let skippedFreshRegions = 0;

      try {
        for (const region of TARGET_REGIONS) {
          const freshData = await marketSnapshotStore.getFresh(region, itemId);

          if (freshData) {
            await pool.query(
              `INSERT INTO job_history (job_id, item_id, region, status, completed_at, created_at)
               VALUES ($1, $2, $3, $4, now(), now())`,
              [job.id, itemId, region, "skipped_fresh"],
            );

            skippedFreshRegions++;
            continue;
          }

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

        if (processedRegions + skippedFreshRegions > 0) {
          await pool.query("UPDATE marketable_items SET last_scanned = now() WHERE item_id = $1", [
            itemId,
          ]);
        }

        const duration = Date.now() - startTime;
        console.log(
          `[Worker] Processed item_id=${itemId} regions=${processedRegions}/${TARGET_REGIONS.length} skippedFresh=${skippedFreshRegions} duration=${duration}ms`,
        );

        return {
          processed: processedRegions + skippedFreshRegions > 0,
          processedRegions,
          skippedFreshRegions,
          duration,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

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
