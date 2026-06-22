import { config } from "../config.js";
import { getItemScanJobId, getQueue, TARGET_REGIONS } from "./jobQueue.js";
import { universalis } from "./universalis.js";
import { pool } from "../db/pool.js";

export class JobScheduler {
  private lastScheduleTime = 0;
  private scheduleInProgress = false;
  private scheduleCooldownMs = 60_000;

  async initialize(): Promise<void> {
    console.log("[JobScheduler] Initializing...");
    console.log(`[JobScheduler] Target regions: ${TARGET_REGIONS.join(", ")}`);

    await this.seedMarketableItems();

    this.startDailyItemRefresh();

    await this.scheduleJobs();
  }

  private startDailyItemRefresh(): void {
    const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

    const doRefresh = async () => {
      try {
        await this.refreshMarketableItems();
      } catch (error) {
        console.error(
          `[JobScheduler] Daily item refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

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
      const result = await pool.query(
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
      const count = await pool.query<{ count: string }>(
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

      const chunkSize = 1000;
      for (let i = 0; i < itemIds.length; i += chunkSize) {
        const chunk = itemIds.slice(i, i + chunkSize);
        const placeholders = chunk.map((_, idx: number) => `($${idx + 1})`).join(",");
        const query = `
          INSERT INTO marketable_items (item_id)
          VALUES ${placeholders}
          ON CONFLICT (item_id) DO NOTHING
        `;
        await pool.query(query, chunk);
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
    if (this.scheduleInProgress) {
      return;
    }

    const now = Date.now();
    if (now - this.lastScheduleTime < this.scheduleCooldownMs) {
      return;
    }

    this.scheduleInProgress = true;

    try {
      console.log("[JobScheduler] Scheduling jobs...");

      await pool.query("DELETE FROM job_history WHERE created_at < now() - interval '7 days'");

      const result = await pool.query<{ item_id: number }>(
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
      const counts = await queue.getJobCounts("active", "delayed", "prioritized", "waiting");
      const waitingJobs = (counts.waiting ?? 0) + (counts.wait ?? 0);
      const outstandingJobs =
        (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0) + waitingJobs;

      if (outstandingJobs > 0) {
        console.log(
          `[JobScheduler] ${outstandingJobs} scan job(s) still queued; skipping schedule`,
        );
        return;
      }

      this.lastScheduleTime = now;

      const reqPerSecond = config.universalisRequestsPerSecond;

      const totalRequests = itemIds.length * TARGET_REGIONS.length;
      const estimatedScanSeconds = totalRequests / reqPerSecond;
      const estimatedScanMinutes = (estimatedScanSeconds / 60).toFixed(1);

      this.scheduleCooldownMs = Math.max(60_000, estimatedScanSeconds * 1000);

      console.log(
        `[JobScheduler] Queueing ${itemIds.length} item scan jobs ` +
          `(${totalRequests} Universalis requests across ${TARGET_REGIONS.length} regions)`,
      );
      console.log(`[JobScheduler] Rate limit: ${reqPerSecond} Universalis req/s`);
      console.log(
        `[JobScheduler] Estimated full scan time: ~${estimatedScanMinutes} minutes ` +
          `(${estimatedScanSeconds.toFixed(0)}s at ${reqPerSecond} req/s)`,
      );

      const bulkBatchSize = 1000;
      const allJobs: {
        name: string;
        data: { itemId: number };
        opts: { jobId: string };
      }[] = [];

      for (const itemId of itemIds) {
        allJobs.push({
          name: getItemScanJobId(itemId),
          data: { itemId },
          opts: {
            jobId: getItemScanJobId(itemId),
          },
        });
      }

      for (let i = 0; i < allJobs.length; i += bulkBatchSize) {
        const batch = allJobs.slice(i, i + bulkBatchSize);
        await queue.addBulk(batch);
      }

      console.log(`[JobScheduler] Successfully queued ${itemIds.length} item scan jobs`);
    } catch (error) {
      console.error(
        `[JobScheduler] Error scheduling jobs: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.scheduleInProgress = false;
    }
  }

  async close(): Promise<void> {}
}

let scheduler: JobScheduler | null = null;

export function getScheduler(): JobScheduler {
  if (!scheduler) {
    scheduler = new JobScheduler();
  }
  return scheduler;
}
