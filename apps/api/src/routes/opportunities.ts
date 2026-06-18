import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ArbitrageCache } from "../services/arbitrageCache.js";
import { getQueueStats } from "../services/jobQueue.js";
import { marketSnapshotStore } from "../services/marketSnapshotStore.js";
import { universalis } from "../services/universalis.js";
import { XivApiClient } from "../services/xivapi.js";
import { config } from "../config.js";
import { iqrAverage } from "../services/stats.js";
import pool from "../db/pool.js";
import { createClient } from "redis";

const dcDisparityQuerySchema = z.object({
  highDc: z.string().optional(),
  lowDc: z.string().optional(),
  minSpread: z.coerce.number().nonnegative().optional(),
  minSpreadPercent: z.coerce.number().nonnegative().optional(),
  region: z.string().optional(),
  sort: z.enum(["spread", "spreadPercent", "item"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().max(200).optional(),
});

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
    const result = await pool.query("SELECT NOW()");
    return !!result.rows[0];
  } catch {
    return false;
  }
}

const redisClient = createClient({ url: config.redisUrl });
redisClient.on("error", () => {});
let redisConnected = false;
redisClient
  .connect()
  .then(() => {
    redisConnected = true;
  })
  .catch(() => {
    redisConnected = false;
  });

async function checkRedisHealth(): Promise<boolean> {
  try {
    if (!redisConnected) {
      await redisClient.connect();
      redisConnected = true;
    }
    await redisClient.ping();
    return true;
  } catch {
    redisConnected = false;
    return false;
  }
}

export async function opportunityRoutes(app: FastifyInstance) {
  const arbitrage = new ArbitrageCache();
  arbitrage.start();

  const { bargainsCache } = await import("../services/bargainsCache.js");
  bargainsCache.start();

  const { dcDisparityCache } = await import("../services/dcDisparityCache.js");
  dcDisparityCache.start();

  const { dcAverageStore } = await import("../services/dcAverageStore.js");
  dcAverageStore.start();

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

    if (includeHistory && config.databaseUrl) {
      try {
        const itemIds = response.opportunities.map((o) => o.itemId);
        if (itemIds.length > 0) {
          const result = await pool.query<{
            item_id: number;
            fetched_at: string;
            avg_price: number;
          }>(
            `SELECT item_id, fetched_at, (data->>'averagePrice')::numeric as avg_price
             FROM market_snapshots
             WHERE item_id = ANY($1::int[])
               AND fetched_at > now() - interval '7 days'
             ORDER BY fetched_at DESC`,
            [itemIds],
          );

          const historyByItem = new Map<number, { timestamp: string; price: number }[]>();
          for (const row of result.rows) {
            let arr = historyByItem.get(row.item_id);
            if (!arr) {
              arr = [];
              historyByItem.set(row.item_id, arr);
            }
            arr.push({
              timestamp: row.fetched_at,
              price: Math.round(Number(row.avg_price)),
            });
          }

          for (const opportunity of response.opportunities) {
            (opportunity as any).history = historyByItem.get(opportunity.itemId) ?? [];
          }
        }
      } catch (error) {
        console.error("Error fetching historical data:", error);
      }
    }

    return response;
  });

  // In-memory cache for XIVAPI search results (no need to re-query same term)
  const searchCache = new Map<
    string,
    { results: { id: number; name: string; iconUrl?: string; category?: string }[] }
  >();

  app.get("/items/search", async (request, reply) => {
    const { q } = z.object({ q: z.string().min(1).max(100) }).parse(request.query);
    const cached = searchCache.get(q);
    if (cached) return cached;

    try {
      const sanitized = q.replace(/["\\]/g, "").trim();
      const url = new URL(`${config.xivapiBaseUrl}/search`);
      url.searchParams.set("query", `Name~"${sanitized}"`);
      url.searchParams.set("sheets", "Item");
      url.searchParams.set("fields", "Name,Icon,ItemUICategory.Name");
      url.searchParams.set("limit", "20");

      const response = await fetch(url, {
        headers: { "User-Agent": "xiv-arbitrage/0.1.0" },
      });

      if (!response.ok) {
        return reply.status(502).send({ error: "Search service unavailable" });
      }

      const data = (await response.json()) as {
        results?: {
          row_id: number;
          fields: {
            Name: string;
            Icon?: { path?: string; path_hr1?: string };
            ItemUICategory?: { fields?: { Name: string } };
          };
        }[];
      };

      const results = (data.results ?? []).map((r) => {
        const iconPath = r.fields.Icon?.path_hr1 ?? r.fields.Icon?.path;
        return {
          id: r.row_id,
          name: r.fields.Name ?? `Item ${r.row_id}`,
          iconUrl: iconPath
            ? `${config.xivapiBaseUrl}/asset?path=${encodeURIComponent(iconPath)}&format=png`
            : undefined,
          category: r.fields.ItemUICategory?.fields?.Name,
        };
      });

      const result = { results };
      searchCache.set(q, result);
      if (searchCache.size > 500) {
        const keys = Array.from(searchCache.keys());
        for (let i = 0; i < 250; i++) searchCache.delete(keys[i]!);
      }
      return result;
    } catch {
      return reply.status(502).send({ error: "Search failed" });
    }
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
      if (avg !== null && prices.length >= 7) {
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

  app.get("/bargains", async () => {
    return bargainsCache.get();
  });

  app.get("/dc-disparities", async (request) => {
    const query = dcDisparityQuerySchema.parse(request.query);
    return dcDisparityCache.get(query);
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
