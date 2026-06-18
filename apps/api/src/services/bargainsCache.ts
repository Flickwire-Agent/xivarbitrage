import type { BargainListing } from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import pool from "../db/pool.js";
import { UniversalisClient } from "./universalis.js";
import type { UniversalisMarketData } from "./universalis.js";
import { iqrAverage } from "./stats.js";
import { dcAverageStore } from "./dcAverageStore.js";

export class BargainsCache {
  private latest: BargainListing[] = [];
  private generatedAt = "";
  private refreshPromise: Promise<void> | null = null;
  private universalis = new UniversalisClient();
  private worldDataCenters: Record<number, string> = {};

  constructor() {}

  start() {
    void this.refresh();
    setInterval(() => void this.refresh(), config.arbitrageRefreshMinutes * 60 * 1000).unref();
  }

  async get(): Promise<{ generatedAt: string; bargains: BargainListing[] }> {
    if (this.latest.length === 0) await this.refresh();
    return { generatedAt: this.generatedAt, bargains: this.latest };
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.scan()
      .then((bargains) => {
        this.latest = bargains;
        this.generatedAt = new Date().toISOString();
        console.log(`[BargainsCache] Refreshed with ${bargains.length} bargains`);
      })
      .catch((error) => {
        console.error(`[BargainsCache] Error refreshing: ${error}`);
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  private async scan(): Promise<BargainListing[]> {
    if (!config.databaseUrl) return [];

    if (Object.keys(this.worldDataCenters).length === 0) {
      try {
        const dcs = await this.universalis.getDataCenters();
        for (const dc of dcs) {
          for (const wid of dc.worlds) {
            this.worldDataCenters[wid] = dc.name;
          }
        }
      } catch {}
    }

    const dcAverages = await dcAverageStore.getAverages();
    const dcAvgLookup = new Map<number, Map<string, number>>();
    for (const avg of dcAverages) {
      let byDc = dcAvgLookup.get(avg.itemId);
      if (!byDc) {
        byDc = new Map();
        dcAvgLookup.set(avg.itemId, byDc);
      }
      byDc.set(avg.dataCenter, avg.avgPrice);
    }

    const itemResult = await pool.query<{ item_id: number }>(
      `SELECT DISTINCT s.item_id
       FROM market_snapshots s
       WHERE s.fetched_at > now() - interval '24 hours'
          AND EXISTS (SELECT 1 FROM sale_history h WHERE h.item_id = s.item_id AND h.sold_at > now() - interval '30 days')
       LIMIT 3000`,
    );

    if (itemResult.rows.length === 0) return [];

    const allItemIds = itemResult.rows.map((r) => r.item_id);

    const salesResult = await pool.query<{
      item_id: number;
      price_per_unit: number;
    }>(
      `SELECT item_id, price_per_unit
       FROM sale_history
       WHERE item_id = ANY($1::int[]) AND sold_at > now() - interval '30 days'`,
      [allItemIds],
    );

    const globalIqrByItem = new Map<number, number | null>();
    const pricesByItem = new Map<number, number[]>();
    for (const row of salesResult.rows) {
      let prices = pricesByItem.get(row.item_id);
      if (!prices) {
        prices = [];
        pricesByItem.set(row.item_id, prices);
      }
      prices.push(row.price_per_unit);
    }
    for (const [itemId, prices] of pricesByItem) {
      globalIqrByItem.set(itemId, iqrAverage(prices));
    }

    const batchSize = 250;
    const allBargains: BargainListing[] = [];

    for (let i = 0; i < allItemIds.length; i += batchSize) {
      const batch = allItemIds.slice(i, i + batchSize);

      const snapResult = await pool.query<{ item_id: number; data: UniversalisMarketData }>(
        `SELECT DISTINCT ON (item_id) item_id, data
         FROM market_snapshots
         WHERE item_id = ANY($1::int[])
         ORDER BY item_id, fetched_at DESC`,
        [batch],
      );

      for (const row of snapResult.rows) {
        const itemListings = row.data.listings;
        if (!itemListings?.length) continue;

        const itemDcAvg = dcAvgLookup.get(row.item_id);
        const globalIqr = globalIqrByItem.get(row.item_id) ?? null;

        for (const listing of itemListings) {
          if (!listing.pricePerUnit || listing.pricePerUnit <= 0) continue;
          const worldId = listing.worldID ?? 0;
          const dc = this.worldDataCenters[worldId] ?? "Unknown";
          const avg = itemDcAvg?.get(dc) ?? globalIqr ?? 0;
          if (avg <= 0) continue;

          const discount = avg - listing.pricePerUnit;
          if (discount <= 0) continue;

          allBargains.push({
            itemId: row.item_id,
            worldId,
            worldName: listing.worldName ?? "Unknown",
            dataCenter: dc,
            pricePerUnit: listing.pricePerUnit,
            quantity: listing.quantity,
            recentAvgPrice: avg,
            discount,
            discountPercent: Math.round((discount / avg) * 100),
          });
        }
      }
    }

    allBargains.sort((a, b) => b.discountPercent - a.discountPercent);
    return allBargains.slice(0, 200);
  }
}

export const bargainsCache = new BargainsCache();
