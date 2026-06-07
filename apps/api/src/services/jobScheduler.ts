import pg from "pg";
import { config } from "../config.js";
import { getQueue } from "./jobQueue.js";
import { universalis } from "./universalis.js";
import type { EvaluateItemJob } from "./jobQueue.js";

const { Pool } = pg;

// Target regions for market scanning.
// To re-enable additional regions, add them back to this array:
//   "North-America" | "Europe" | "Oceania"
const TARGET_REGIONS = ["Europe"];

export class JobScheduler {
  private db: pg.Pool;
  private lastScheduleTime = 0;
  private scheduleInProgress = false;

  constructor() {
    this.db = new Pool({
      connectionString: config.databaseUrl!,
      ssl: config.databaseUrl!.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    });
  }

  async initialize(): Promise<void> {
    console.log("[JobScheduler] Initializing...");
    console.log(`[JobScheduler] Target regions: ${TARGET_REGIONS.join(", ")}`);

    // Load all marketable items into database if not already done
    await this.seedMarketableItems();

    // Schedule initial jobs
    await this.scheduleJobs();
  }

  private async seedMarketableItems(): Promise<void> {
    try {
      const count = await this.db.query<{ count: string }>(
        "SELECT COUNT(*)::text as count FROM marketable_items"
      );

      const itemCount = parseInt(count.rows[0]?.count ?? "0", 10);

      if (itemCount > 100) {
        console.log(
          `[JobScheduler] Found ${itemCount} existing items in marketable_items table`
        );
        return;
      }

      console.log("[JobScheduler] Fetching all marketable items from Universalis...");
      const itemIds = await universalis.getMarketableItemIds();

      if (!itemIds || itemIds.length === 0) {
        console.error("[JobScheduler] No items received from Universalis API");
        return;
      }

      console.log(
        `[JobScheduler] Received ${itemIds.length} items, inserting into database...`
      );

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
        `[JobScheduler] Successfully seeded ${itemIds.length} items to marketable_items table`
      );
    } catch (error) {
      console.error(
        `[JobScheduler] Error seeding marketable items: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async scheduleJobs(): Promise<void> {
    // Prevent concurrent scheduling
    if (this.scheduleInProgress) {
      return;
    }

    // Prevent scheduling more than once per minute
    const now = Date.now();
    if (now - this.lastScheduleTime < 60000) {
      return;
    }

    this.scheduleInProgress = true;
    this.lastScheduleTime = now;

    try {
      console.log("[JobScheduler] Scheduling jobs...");

      // Get all items that need scanning
      const result = await this.db.query<{ item_id: number }>(
        `SELECT item_id FROM marketable_items 
         WHERE last_scanned IS NULL 
            OR last_scanned < now() - interval '1 day'
         ORDER BY last_scanned NULLS FIRST`
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

      // Calculate stagger timing to spread jobs evenly over 24 hours
      // Target: complete all jobs in 24 hours
      // With concurrency=4 and 20 req/sec rate limit:
      // Each job takes ~1 second (API call + DB write)
      // Total time needed: (itemCount * regions) / concurrency
      // We want to spread this over 24 hours to avoid overwhelming the API
      const totalJobs = jobs.length;
      const jobsPerSecond = totalJobs / (24 * 3600); // Jobs per second over 24 hours
      const delayBetweenJobs = Math.max(1, Math.floor(1000 / jobsPerSecond)); // Minimum 1ms between jobs

      console.log(
        `[JobScheduler] Queueing ${totalJobs} jobs (${itemIds.length} items × ${TARGET_REGIONS.length} regions)`
      );
      console.log(
        `[JobScheduler] Spacing jobs ${delayBetweenJobs}ms apart to spread over 24 hours`
      );

      // Add jobs to queue with staggered delays
      let delay = 0;
      for (const job of jobs) {
        await queue.add(`evaluate-item-${job.itemId}-${job.region}`, job, {
          delay,
          priority: Math.floor(100 - ((delay / 1000) % 100)) // Prioritize older delays slightly
        });

        delay += delayBetweenJobs;
      }

      console.log(`[JobScheduler] Successfully queued ${totalJobs} jobs`);
    } catch (error) {
      console.error(
        `[JobScheduler] Error scheduling jobs: ${error instanceof Error ? error.message : String(error)}`
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
