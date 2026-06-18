import { Worker } from "bullmq";
import { config } from "../config.js";
import { universalis } from "./universalis.js";
import { marketSnapshotStore } from "./marketSnapshotStore.js";
import { rateLimiter } from "./rateLimiter.js";
import { pool } from "../db/pool.js";
import type { EvaluateItemJob } from "./jobQueue.js";

let worker: Worker<EvaluateItemJob> | null = null;

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

      try {
        const data = await rateLimiter.schedule(() => universalis.getCurrentData(region, itemId));

        if (data) {
          await marketSnapshotStore.upsert(region, itemId, data);

          await marketSnapshotStore.storeSales(itemId, data);

          await pool.query("UPDATE marketable_items SET last_scanned = now() WHERE item_id = $1", [
            itemId,
          ]);

          await pool.query(
            `INSERT INTO job_history (job_id, item_id, region, status, completed_at, created_at)
             VALUES ($1, $2, $3, $4, now(), now())`,
            [job.id, itemId, region, "completed"],
          );

          const duration = Date.now() - startTime;
          console.log(
            `[Worker] Processed item_id=${itemId} region=${region} duration=${duration}ms`,
          );
        }

        return { processed: true, duration: Date.now() - startTime };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        await pool.query(
          `INSERT INTO job_history (job_id, item_id, region, status, error_message, created_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [job.id, itemId, region, "failed", errorMsg],
        );

        console.error(`[Worker] Failed item_id=${itemId} region=${region} error=${errorMsg}`);
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
