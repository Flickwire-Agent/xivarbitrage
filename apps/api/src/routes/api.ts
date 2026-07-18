import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { xivapiProxy } from "../services/xivapiProxy.js";
import { getQueueStats } from "../services/jobQueue.js";
import { marketSnapshotStore } from "../services/marketSnapshotStore.js";
import { worldDcMapping } from "../services/worldDcMapping.js";
import { config } from "../config.js";
import { iqrAverage } from "../services/stats.js";
import pool from "../db/pool.js";
import { createClient } from "redis";
import { apiUsageMonitor } from "../services/apiUsageMonitor.js";
import type { MarketWarning } from "@xiv-arbitrage/shared";

const HOURS_MS = 60 * 60 * 1000;

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

function msUntilWednesdayMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + ((3 - now.getDay() + 7) % 7 || 7));
  next.setHours(0, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 7);
  return next.getTime() - now.getTime();
}

function getListingWarnings(
  listingData: {
    saleStats: { count: number };
    snapshotFetchedAt: string | null;
    rawListingCount: number;
  },
  dataCenterAverageCount: number,
): MarketWarning[] {
  const warnings: MarketWarning[] = [];

  if (!listingData.snapshotFetchedAt) {
    warnings.push({
      code: "missing_listings",
      severity: "critical",
      message: "No current market-board snapshot is available for this item.",
    });
  } else {
    const fetchedAt = new Date(listingData.snapshotFetchedAt).getTime();
    const staleAfter = Date.now() - config.marketSnapshotFreshHours * HOURS_MS;
    if (Number.isFinite(fetchedAt) && fetchedAt < staleAfter) {
      warnings.push({
        code: "stale_snapshot",
        severity: "warning",
        message: `Current listing snapshot is older than ${config.marketSnapshotFreshHours} hours.`,
      });
    }
  }

  if (listingData.rawListingCount === 0) {
    warnings.push({
      code: "missing_listings",
      severity: "warning",
      message: "The latest snapshot did not include any active listings.",
    });
  }

  if (listingData.saleStats.count === 0) {
    warnings.push({
      code: "thin_price_history",
      severity: "critical",
      message: "No completed sales were recorded in the last 30 days.",
    });
  } else if (listingData.saleStats.count < config.marketWarningLowSaleCount) {
    warnings.push({
      code: "low_sales",
      severity: "warning",
      message: `Only ${listingData.saleStats.count} completed sales in the last 30 days.`,
    });
  }

  if (dataCenterAverageCount < config.marketWarningMinDataCenters) {
    warnings.push({
      code: "limited_dc_coverage",
      severity: "warning",
      message: `${dataCenterAverageCount === 0 ? "No data centers have" : `Only ${dataCenterAverageCount} data center${dataCenterAverageCount === 1 ? " has" : "s have"}`} enough sales for a comparison average.`,
    });
  }

  return warnings;
}

export async function apiRoutes(app: FastifyInstance) {
  await worldDcMapping.refresh();

  const { dcAverageStore } = await import("../services/dcAverageStore.js");
  dcAverageStore.start();
  // Wait for at least one average recompute before populating caches
  await dcAverageStore.recompute();

  const { bargainsCache } = await import("../services/bargainsCache.js");
  bargainsCache.start();

  const { dcDisparityCache } = await import("../services/dcDisparityCache.js");
  dcDisparityCache.start();

  const refreshTimer = setTimeout(async () => {
    await worldDcMapping.refresh();
    setInterval(() => void worldDcMapping.refresh(), 7 * 24 * 60 * 60 * 1000).unref();
  }, msUntilWednesdayMidnight());
  refreshTimer.unref();

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

  app.get("/worlds", async () => {
    const mapping = await worldDcMapping.getMapping();
    return {
      worlds: mapping.worlds,
      dataCenters: mapping.dataCenters,
      regions: mapping.regions,
      worldIdToDc: mapping.worldIdToDc,
      updatedAt: mapping.updatedAt,
    };
  });

  app.post("/worlds/refresh", async () => {
    await worldDcMapping.refresh();
    return { ok: true };
  });

  app.get<{ Params: { itemId: string } }>("/items/:itemId/listings", async (request, reply) => {
    const itemId = Number(request.params.itemId);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.status(400).send({ error: "Invalid item ID" });
    }

    const [listingData, mapping, metadata] = await Promise.all([
      marketSnapshotStore.getCurrentListings(itemId),
      worldDcMapping.getMapping(),
      xivapiProxy.fetchItemDetailsBatch([itemId], 1800),
    ]);

    const dcPrices: Record<string, number[]> = {};
    for (const sale of listingData.sales) {
      const dc = mapping.worldIdToDc[sale.worldId];
      if (!dc) continue;
      if (!dcPrices[dc]) dcPrices[dc] = [];
      dcPrices[dc].push(sale.pricePerUnit);
    }

    const dcAverages: Record<string, { avgPrice: number; count: number }> = {};
    for (const [dc, prices] of Object.entries(dcPrices)) {
      const avg = iqrAverage(prices);
      if (avg !== null && prices.length >= 7) {
        dcAverages[dc] = { avgPrice: avg, count: prices.length };
      }
    }

    const allPrices = listingData.sales.map((s) => s.pricePerUnit);
    const globalAvg = iqrAverage(allPrices);

    const listings = listingData.listings
      .map((l) => {
        const dc = mapping.worldIdToDc[l.worldId] ?? "Unknown";
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
      itemDetails: metadata.itemDetails,
      listings,
      warnings: getListingWarnings(listingData, Object.keys(dcAverages).length),
      saleStats: {
        avgPrice: globalAvg ?? 0,
        count: listingData.saleStats.count,
        perDataCenter: dcAverages,
      },
    };
  });

  const bargainsQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(200).optional(),
    minAvgPrice: z.coerce.number().nonnegative().optional(),
    minDiscount: z.coerce.number().nonnegative().optional(),
    minDiscountPercent: z.coerce.number().nonnegative().optional(),
    minQuantity: z.coerce.number().int().positive().optional(),
    dataCenter: z.string().trim().optional(),
    world: z.string().trim().optional(),
    sort: z.enum(["discount", "discountPercent", "price"]).optional(),
  });

  app.get("/bargains", async (request) => {
    const query = bargainsQuerySchema.parse(request.query);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 50;
    const { generatedAt, bargains: allBargains } = await bargainsCache.get();
    let filtered = allBargains;

    if (query.minAvgPrice !== undefined) {
      filtered = filtered.filter((b) => b.recentAvgPrice >= query.minAvgPrice!);
    }
    if (query.minDiscount !== undefined) {
      filtered = filtered.filter((b) => b.discount >= query.minDiscount!);
    }
    if (query.minDiscountPercent !== undefined) {
      filtered = filtered.filter((b) => b.discountPercent >= query.minDiscountPercent!);
    }
    if (query.minQuantity !== undefined) {
      filtered = filtered.filter((b) => b.quantity >= query.minQuantity!);
    }
    if (query.dataCenter) {
      const dc = query.dataCenter.toLowerCase();
      filtered = filtered.filter((b) => b.dataCenter.toLowerCase() === dc);
    }
    if (query.world) {
      const world = query.world.toLowerCase();
      filtered = filtered.filter((b) => b.worldName.toLowerCase() === world);
    }

    const sorted = [...filtered].sort((a, b) => {
      if (query.sort === "discount") return b.discount - a.discount;
      if (query.sort === "price") return b.recentAvgPrice - a.recentAvgPrice;
      return b.discountPercent - a.discountPercent;
    });

    const total = sorted.length;
    const totalPages = Math.ceil(total / perPage);
    const start = (page - 1) * perPage;
    const bargains = sorted.slice(start, start + perPage);
    const metadata = await xivapiProxy.fetchItemDetailsBatch(
      bargains.map((b) => b.itemId),
      3000,
    );
    return {
      generatedAt,
      bargains,
      itemDetails: metadata.itemDetails,
      total,
      page,
      perPage,
      totalPages,
    };
  });

  app.get("/dc-disparities", async (request) => {
    const query = dcDisparityQuerySchema.parse(request.query);
    const result = await dcDisparityCache.get(query);
    const metadata = await xivapiProxy.fetchItemDetailsBatch(
      result.disparities.map((d) => d.itemId),
      3000,
    );
    return { ...result, itemDetails: metadata.itemDetails };
  });

  app.get<{ Params: { itemId: string } }>("/items/:itemId/history", async (request, reply) => {
    const itemId = Number(request.params.itemId);

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.status(400).send({ error: "Invalid item ID" });
    }

    const [sales, metadata] = await Promise.all([
      marketSnapshotStore.getSaleHistory(itemId),
      xivapiProxy.fetchItemDetailsBatch([itemId], 1800),
    ]);

    return {
      itemId,
      itemDetails: metadata.itemDetails,
      sales,
      worlds: [...new Set(sales.map((s) => s.worldName))].sort(),
    };
  });

  app.get("/worker/status", async () => {
    try {
      const stats = await getQueueStats();

      if (!config.databaseUrl) {
        return { error: "Database not configured" };
      }

      const [itemStats, regionStats, jobStats, lastScan] = await Promise.all([
        pool.query<{ count: string; scanned: string }>(
          `WITH region_counts AS (
             SELECT
               item_id,
               COUNT(*) FILTER (WHERE last_scanned IS NOT NULL)::integer AS scanned_regions,
               COUNT(*)::integer AS target_regions
             FROM item_region_scan_state
             GROUP BY item_id
           )
           SELECT
             COUNT(*)::text as count,
             COUNT(CASE WHEN region_counts.scanned_regions = region_counts.target_regions THEN 1 END)::text as scanned
           FROM marketable_items
           LEFT JOIN region_counts USING (item_id)`,
        ),
        pool.query<{ count: string; scanned: string; due: string }>(
          `SELECT
            COUNT(*)::text as count,
            COUNT(CASE WHEN last_scanned IS NOT NULL THEN 1 END)::text as scanned,
            COUNT(CASE WHEN next_scan_at <= now() THEN 1 END)::text as due
          FROM item_region_scan_state`,
        ),
        pool.query<{ count: string; status: string }>(
          `SELECT status, COUNT(*)::text as count
           FROM job_history
           WHERE created_at > now() - interval '24 hours'
           GROUP BY status`,
        ),
        pool.query<{ last_scanned: string | null }>(
          `SELECT MAX(last_scanned) as last_scanned FROM item_region_scan_state`,
        ),
      ]);

      const totalItems = parseInt(itemStats.rows[0]?.count ?? "0", 10);
      const scannedItems = parseInt(itemStats.rows[0]?.scanned ?? "0", 10);
      const totalItemRegions = parseInt(regionStats.rows[0]?.count ?? "0", 10);
      const scannedItemRegions = parseInt(regionStats.rows[0]?.scanned ?? "0", 10);
      const dueItemRegions = parseInt(regionStats.rows[0]?.due ?? "0", 10);
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
        itemRegions: {
          total: totalItemRegions,
          scanned: scannedItemRegions,
          due: dueItemRegions,
          progress:
            totalItemRegions > 0
              ? ((scannedItemRegions / totalItemRegions) * 100).toFixed(2) + "%"
              : "0%",
        },
        jobs24h: jobsByStatus,
        lastFullScan: lastScan.rows[0]?.last_scanned,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get<{ Params: { itemId: string } }>("/xivapi/sheet/Item/:itemId", async (request, reply) => {
    const itemId = Number(request.params.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.status(400).send({ error: "Invalid item ID" });
    }
    const fields =
      ((request.query as Record<string, string>).fields as string | undefined) ??
      "Name,Icon,ItemUICategory.Name";
    try {
      return await xivapiProxy.fetchSheetItem(itemId, fields);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(502).send({ error: msg });
    }
  });

  app.get("/xivapi/items", async (request, reply) => {
    const rawQuery = request.query as Record<string, string | string[] | undefined>;
    const rawIds = Array.isArray(rawQuery.ids) ? rawQuery.ids.join(",") : rawQuery.ids;
    const itemIds = (rawIds ?? "")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 200);
    const waitMs = Math.min(3000, Math.max(0, Number(rawQuery.waitMs ?? 1800)));

    if (itemIds.length === 0) {
      return reply.status(400).send({ error: "Missing item IDs" });
    }

    return xivapiProxy.fetchItemDetailsBatch(itemIds, waitMs);
  });

  app.get("/xivapi/search", async (request, reply) => {
    const rawQuery = request.query as Record<string, string | string[]>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(rawQuery)) {
      if (typeof value === "string") {
        params.set(key, value);
      }
    }
    try {
      return await xivapiProxy.fetchSearch(params);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.status(502).send({ error: msg });
    }
  });

  app.get("/monitoring/usage", async (request) => {
    const hoursBack = Math.min(168, Math.max(1, Number((request.query as any).hours ?? 24)));
    return apiUsageMonitor.getSummary(hoursBack);
  });

  // OG image endpoints
  const { generateDisparitiesOg, generateBargainsOg, generateItemOg } =
    await import("../services/ogGenerator.js");

  app.get("/og/disparities", async (request, reply) => {
    const page = Math.max(1, Number((request.query as any).page ?? 1));
    const png = await generateDisparitiesOg(page);
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=900")
      .send(png);
  });

  app.get("/og/bargains", async (request, reply) => {
    const page = Math.max(1, Number((request.query as any).page ?? 1));
    const png = await generateBargainsOg(page);
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=900")
      .send(png);
  });

  app.get<{ Params: { itemId: string } }>("/og/items/:itemId", async (request, reply) => {
    const itemId = Number(request.params.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return reply.status(400).send({ error: "Invalid item ID" });
    }
    const png = await generateItemOg(itemId);
    return reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "public, max-age=900")
      .send(png);
  });
}
