import pg from "pg";
import { config } from "../config.js";
import { getQueue } from "./jobQueue.js";
import { universalis } from "./universalis.js";
import type { EvaluateItemJob } from "./jobQueue.js";

const { Pool } = pg;

// Target regions for market scanning.
// Materia (Oceania) characters can data-center-travel to all regions,
// so scanning all three covers every server reachable from Materia.
const TARGET_REGIONS = ["North-America", "Europe", "Oceania"];

export class JobScheduler {
  private db: pg.Pool;
  private lastScheduleTime = 0;
  private scheduleInProgress = false;
  // Cooldown is updated after each scheduling pass to match the estimated scan
  // cycle duration, so a new batch is only enqueued once the prior one is
  // nearly complete — enabling continuous back-to-back refresh cycles.
  private scheduleCooldownMs = 60_000; // conservative default until first pass

  constructor() {
    this.db = new Pool({
      connectionString: config.databaseUrl!,
      ssl: config.databaseUrl!.includes("localhost") ? false : { rejectUnauthorized: false },
    });
  }

  async initialize(): Promise<void> {
    console.log("[JobScheduler] Initializing...");
    console.log(`[JobScheduler] Target regions: ${TARGET_REGIONS.join(", ")}`);

    // Load all marketable items into database if not already done
    await this.seedMarketableItems();

    // Schedule a daily refresh of the item list to pick up newly added items
    this.startDailyItemRefresh();

    // Schedule initial jobs
    await this.scheduleJobs();
  }

  private startDailyItemRefresh(): void {
    const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

    const doRefresh = async () => {
      try {
        await this.refreshMarketableItems();
      } catch (error) {
        console.error(
          `[JobScheduler] Daily item refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    // Run once immediately after the first scan cycle completes, then every 24 hours
    setTimeout(async () => {
      await doRefresh();
      setInterval(doRefresh, REFRESH_INTERVAL_MS).unref();
    }, 60_000).unref();
  }

  private async refreshMarketableItems(): Promise<void> {
    console.log("[JobScheduler] Refreshing marketable items list from Universalis...");
    const itemIds = await universalis.getMarketableItemIds();

    if (!itemIds || itemIds.length === 0) {
      console.error("[JobScheduler] No items received from Universalis during refresh");
      return;
    }

    let inserted = 0;
    const chunkSize = 1000;
    for (let i = 0; i < itemIds.length; i += chunkSize) {
      const chunk = itemIds.slice(i, i + chunkSize);
      const placeholders = chunk.map((_, idx) => `($${idx + 1})`).join(",");
      const result = await this.db.query(
        `
          INSERT INTO marketable_items (item_id)
          VALUES ${placeholders}
          ON CONFLICT (item_id) DO NOTHING
        `,
        chunk,
      );
      inserted += result.rowCount ?? 0;
    }

    if (inserted > 0) {
      console.log(
        `[JobScheduler] Added ${inserted} new item(s) to marketable_items (total: ${itemIds.length})`,
      );
    } else {
      console.log(`[JobScheduler] Item list is up to date (${itemIds.length} items)`);
    }
  }

  private async seedMarketableItems(): Promise<void> {
    try {
      const count = await this.db.query<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM marketable_items",
      );

      const itemCount = parseInt(count.rows[0]?.count ?? "0", 10);

      if (itemCount > 100) {
        console.log(`[JobScheduler] Found ${itemCount} existing items in marketable_items table`);
        return;
      }

      console.log("[JobScheduler] Fetching all marketable items from Universalis...");
      const itemIds = await universalis.getMarketableItemIds();

      if (!itemIds || itemIds.length === 0) {
        console.error("[JobScheduler] No items received from Universalis API");
        return;
      }

      console.log(`[JobScheduler] Received ${itemIds.length} items, inserting into database...`);

      // Batch insert in chunks to avoid query size limits
      const chunkSize = 1000;
      for (let i = 0; i < itemIds.length; i += chunkSize) {
        const chunk = itemIds.slice(i, i + chunkSize);
        const placeholders = chunk.map((_, idx: number) => `($${idx + 1})`).join(",");
        const query = `
          INSERT INTO marketable_items (item_id)
          VALUES ${placeholders}
          ON CONFLICT (item_id) DO NOTHING
        `;
        await this.db.query(query, chunk);
      }

      console.log(
        `[JobScheduler] Successfully seeded ${itemIds.length} items to marketable_items table`,
      );
    } catch (error) {
      console.error(
        `[JobScheduler] Error seeding marketable items: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async scheduleJobs(): Promise<void> {
    // Prevent concurrent scheduling
    if (this.scheduleInProgress) {
      return;
    }

    // Prevent a new scheduling pass from starting before the previous batch has
    // had time to run. The cooldown is set to the estimated scan cycle duration
    // after each pass, so batches chain back-to-back as fast as the API allows.
    const now = Date.now();
    if (now - this.lastScheduleTime < this.scheduleCooldownMs) {
      return;
    }

    this.scheduleInProgress = true;
    this.lastScheduleTime = now;

    try {
      console.log("[JobScheduler] Scheduling jobs...");

      // Fetch all items ordered by staleness so the least-recently-scanned items
      // are always processed first. There is no age filter — with continuous
      // cycling every item is refreshed as fast as the API rate allows, so we
      // never want to skip items that were scanned "recently".
      const result = await this.db.query<{ item_id: number }>(
        `SELECT item_id FROM marketable_items
         ORDER BY last_scanned NULLS FIRST`,
      );

      const itemIds = result.rows.map((row) => row.item_id);

      if (itemIds.length === 0) {
        console.log("[JobScheduler] No items need scanning");
        this.scheduleInProgress = false;
        return;
      }

      const queue = getQueue();
      const jobs: EvaluateItemJob[] = [];

      // Create jobs for each item × region combination
      for (const itemId of itemIds) {
        for (const region of TARGET_REGIONS) {
          jobs.push({ itemId, region });
        }
      }

      // Calculate stagger timing to maximise refresh frequency while respecting
      // the Universalis API rate limit.
      //
      // Strategy:
      //   - The rate limiter enforces a global cap of `universalisRequestsPerSecond`
      //     across all concurrent workers.
      //   - Each worker therefore gets an equal share of that budget:
      //       perWorkerRate = universalisRequestsPerSecond / jobQueueConcurrency
      //   - To keep every worker continuously busy without any single worker
      //     exceeding its share, we space job *start* times by:
      //       delayBetweenJobs = 1000ms / perWorkerRate
      //   - Once the last job in a batch completes the cycle begins again
      //     immediately, so items are refreshed as fast as the API allows.
      const reqPerSecond = config.universalisRequestsPerSecond;
      const concurrency = config.jobQueueConcurrency;
      const perWorkerRate = reqPerSecond / concurrency; // req/sec per worker
      const delayBetweenJobs = Math.max(1, Math.round(1000 / perWorkerRate)); // ms between job starts

      const totalJobs = jobs.length;
      const estimatedScanSeconds = totalJobs / reqPerSecond;
      const estimatedScanMinutes = (estimatedScanSeconds / 60).toFixed(1);

      // Update the cooldown so the next scheduleJobs() call is deferred until
      // this batch is nearly finished, enabling seamless back-to-back cycles.
      this.scheduleCooldownMs = Math.max(60_000, estimatedScanSeconds * 1000);

      console.log(
        `[JobScheduler] Queueing ${totalJobs} jobs (${itemIds.length} items × ${TARGET_REGIONS.length} regions)`,
      );
      console.log(
        `[JobScheduler] Rate limit: ${reqPerSecond} req/s across ${concurrency} workers ` +
          `(${perWorkerRate} req/s per worker) → ${delayBetweenJobs}ms between jobs`,
      );
      console.log(
        `[JobScheduler] Estimated full scan time: ~${estimatedScanMinutes} minutes ` +
          `(${estimatedScanSeconds.toFixed(0)}s at ${reqPerSecond} req/s)`,
      );

      // Add jobs to queue with staggered delays
      let delay = 0;
      for (const job of jobs) {
        await queue.add(`evaluate-item-${job.itemId}-${job.region}`, job, {
          delay,
          priority: Math.floor(100 - ((delay / 1000) % 100)), // Prioritize older delays slightly
        });

        delay += delayBetweenJobs;
      }

      console.log(`[JobScheduler] Successfully queued ${totalJobs} jobs`);
    } catch (error) {
      console.error(
        `[JobScheduler] Error scheduling jobs: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.scheduleInProgress = false;
    }
  }

  async close(): Promise<void> {
    await this.db.end();
  }
}

// Singleton instance
let scheduler: JobScheduler | null = null;

export function getScheduler(): JobScheduler {
  if (!scheduler) {
    scheduler = new JobScheduler();
  }
  return scheduler;
}
