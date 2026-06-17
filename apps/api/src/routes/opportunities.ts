import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ArbitrageCache } from "../services/arbitrageCache.js";
import { getQueueStats } from "../services/jobQueue.js";
import { marketSnapshotStore } from "../services/marketSnapshotStore.js";
import { universalis } from "../services/universalis.js";
import { XivApiClient } from "../services/xivapi.js";
import { config } from "../config.js";
import pg from "pg";

const { Pool } = pg;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Compute IQR-filtered average from an array of prices. */
function iqrAverage(prices: number[]): number | null {
  if (prices.length === 0) return null;
  if (prices.length <= 3) {
    return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;

  const lowerHalf = sorted.slice(0, Math.floor(n / 2));
  const upperHalf = sorted.slice(Math.ceil(n / 2));

  const q1 = median(lowerHalf);
  const q3 = median(upperHalf);
  const iqr = q3 - q1;

  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const filtered = sorted.filter((p) => p >= lowerBound && p <= upperBound);
  if (filtered.length === 0) {
    return Math.round(sorted.reduce((a, b) => a + b, 0) / n);
  }

  return Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length);
}

const querySchema = z.object({
  highWorld: z.string().optional(),
  highDataCenter: z.string().optional(),
  category: z.string().optional(),
  profile: z.enum(["all", "high-volume", "high-arbitrage"]).optional(),
  minVolume: z.coerce.number().int().nonnegative().optional(),
  minSpread: z.coerce.number().nonnegative().optional(),
  sort: z.enum(["best", "spread", "spreadPercent", "volume", "velocity"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  refresh: z.coerce.boolean().optional(),
  includeHistory: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().max(100).optional(),
});

async function checkDatabaseHealth(): Promise<boolean> {
  if (!config.databaseUrl) {
    return false;
  }

  try {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
    });

    const result = await pool.query("SELECT NOW()");
    await pool.end();
    return !!result.rows[0];
  } catch {
    return false;
  }
}

async function checkRedisHealth(): Promise<boolean> {
  try {
    const { createClient } = await import("redis");
    const client = createClient({ url: config.redisUrl });
    await client.connect();
    await client.ping();
    await client.disconnect();
    return true;
  } catch {
    return false;
  }
}

export async function opportunityRoutes(app: FastifyInstance) {
  const arbitrage = new ArbitrageCache();
  arbitrage.start();

  app.get("/health", async (request, reply) => {
    const dbHealthy = await checkDatabaseHealth();
    const redisHealthy = await checkRedisHealth();

    if (!dbHealthy || !redisHealthy) {
      return reply.status(503).send({
        error: `Database: ${dbHealthy ? "ok" : "down"}, Redis: ${redisHealthy ? "ok" : "down"}`,
      });
    }

    return { ok: true, database: dbHealthy, redis: redisHealthy };
  });

  app.get("/opportunities", async (request) => {
    const { refresh, includeHistory, ...filters } = querySchema.parse(request.query);
    if (refresh) {
      await arbitrage.refresh();
    }

    const response = await arbitrage.get(filters);

    // If historical data is requested, fetch recent price history for each opportunity
    if (includeHistory && config.databaseUrl) {
      try {
        const pool = new Pool({
          connectionString: config.databaseUrl,
          ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
        });

        // Fetch historical data for each item
        for (const opportunity of response.opportunities) {
          const result = await pool.query<{
            fetched_at: string;
            avg_price: number;
          }>(
            `
            SELECT 
              fetched_at,
              (data->>'averagePrice')::numeric as avg_price
            FROM market_snapshots
            WHERE item_id = $1
              AND fetched_at > now() - interval '7 days'
            ORDER BY fetched_at DESC
            LIMIT 168
            `,
            [opportunity.itemId],
          );

          (opportunity as any).history = result.rows.map((row) => ({
            timestamp: row.fetched_at,
            price: Math.round(Number(row.avg_price)),
          }));
        }

        await pool.end();
      } catch (error) {
        console.error("Error fetching historical data:", error);
      }
    }

    return response;
  });

  app.get<{ Params: { itemId: string } }>("/items/:itemId/listings", async (request, reply) => {
    const itemId = Number(request.params.itemId);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.status(400).send({ error: "Invalid item ID" });
    }

    const [listingData, item, dcList] = await Promise.all([
      marketSnapshotStore.getCurrentListings(itemId),
      new XivApiClient().getItemDetails(itemId),
      universalis.getDataCenters(),
    ]);

    if (!item) {
      return reply.status(404).send({ error: "Item not found" });
    }

    const worldDataCenters: Record<number, string> = {};
    for (const dc of dcList) {
      for (const wid of dc.worlds) {
        worldDataCenters[wid] = dc.name;
      }
    }

    // Group sale records by data center
    const dcPrices: Record<string, number[]> = {};
    for (const sale of listingData.sales) {
      const dc = worldDataCenters[sale.worldId];
      if (!dc) continue;
      if (!dcPrices[dc]) dcPrices[dc] = [];
      dcPrices[dc].push(sale.pricePerUnit);
    }

    // Compute IQR-filtered average per data center
    const dcAverages: Record<string, { avgPrice: number; count: number }> = {};
    for (const [dc, prices] of Object.entries(dcPrices)) {
      const avg = iqrAverage(prices);
      if (avg !== null) {
        dcAverages[dc] = { avgPrice: avg, count: prices.length };
      }
    }

    // Fallback global IQR average for worlds/DCs with no sale data
    const allPrices = listingData.sales.map((s) => s.pricePerUnit);
    const globalAvg = iqrAverage(allPrices);

    const listings = listingData.listings
      .map((l) => {
        const dc = worldDataCenters[l.worldId] ?? "Unknown";
        const dcAvg = dcAverages[dc]?.avgPrice ?? globalAvg ?? 0;
        return {
          worldId: l.worldId,
          worldName: l.worldName,
          dataCenter: dc,
          pricePerUnit: l.pricePerUnit,
          quantity: l.quantity,
          recentAvgPrice: dcAvg,
          discount: dcAvg - l.pricePerUnit,
          discountPercent: dcAvg > 0 ? Math.round(((dcAvg - l.pricePerUnit) / dcAvg) * 100) : 0,
        };
      })
      .filter((l) => l.discount > 0)
      .sort((a, b) => b.discountPercent - a.discountPercent);

    return {
      itemId,
      item,
      listings,
      saleStats: {
        avgPrice: globalAvg ?? 0,
        count: listingData.saleStats.count,
        perDataCenter: dcAverages,
      },
    };
  });

  app.get<{ Params: { itemId: string } }>("/items/:itemId/history", async (request, reply) => {
    const itemId = Number(request.params.itemId);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.status(400).send({ error: "Invalid item ID" });
    }

    const [sales, item, dcList] = await Promise.all([
      marketSnapshotStore.getSaleHistory(itemId),
      new XivApiClient().getItemDetails(itemId),
      universalis.getDataCenters(),
    ]);

    if (!item) {
      return reply.status(404).send({ error: "Item not found" });
    }

    const worldDataCenters: Record<number, string> = {};
    for (const dc of dcList) {
      for (const worldId of dc.worlds) {
        worldDataCenters[worldId] = dc.name;
      }
    }

    return {
      itemId,
      item,
      sales,
      worlds: [...new Set(sales.map((s) => s.worldName))].sort(),
      worldDataCenters,
    };
  });

  app.get("/worker/status", async () => {
    try {
      const stats = await getQueueStats();

      if (!config.databaseUrl) {
        return { error: "Database not configured" };
      }

      const pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
      });

      // Get item and job statistics
      const [itemStats, jobStats, lastScan] = await Promise.all([
        pool.query<{ count: string; scanned: string }>(
          `SELECT 
            COUNT(*)::text as count,
            COUNT(CASE WHEN last_scanned IS NOT NULL THEN 1 END)::text as scanned
          FROM marketable_items`,
        ),
        pool.query<{ count: string; status: string }>(
          `SELECT status, COUNT(*)::text as count
           FROM job_history
           WHERE created_at > now() - interval '24 hours'
           GROUP BY status`,
        ),
        pool.query<{ last_scanned: string | null }>(
          `SELECT MAX(last_scanned) as last_scanned FROM marketable_items`,
        ),
      ]);

      await pool.end();

      const totalItems = parseInt(itemStats.rows[0]?.count ?? "0", 10);
      const scannedItems = parseInt(itemStats.rows[0]?.scanned ?? "0", 10);
      const jobsByStatus = Object.fromEntries(
        jobStats.rows.map((row) => [row.status, parseInt(row.count, 10)]),
      );

      return {
        queue: stats,
        items: {
          total: totalItems,
          scanned: scannedItems,
          progress: totalItems > 0 ? ((scannedItems / totalItems) * 100).toFixed(2) + "%" : "0%",
        },
        jobs24h: jobsByStatus,
        lastFullScan: lastScan.rows[0]?.last_scanned,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
}
