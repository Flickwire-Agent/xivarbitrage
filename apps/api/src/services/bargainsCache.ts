import type { BargainListing, ItemDetails } from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import pool from "../db/pool.js";
import { XivApiClient } from "./xivapi.js";
import { UniversalisClient } from "./universalis.js";
import type { UniversalisMarketData } from "./universalis.js";
import { iqrAverage } from "./stats.js";

export class BargainsCache {
  private latest: BargainListing[] = [];
  private generatedAt = "";
  private refreshPromise: Promise<void> | null = null;
  private xivapi = new XivApiClient();
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
      world_id: number;
      price_per_unit: number;
    }>(
      `SELECT item_id, world_id, price_per_unit
       FROM sale_history
       WHERE item_id = ANY($1::int[]) AND sold_at > now() - interval '30 days'`,
      [allItemIds],
    );

    const salesByItemWorld = new Map<number, Map<number, number[]>>();
    for (const row of salesResult.rows) {
      let byWorld = salesByItemWorld.get(row.item_id);
      if (!byWorld) {
        byWorld = new Map();
        salesByItemWorld.set(row.item_id, byWorld);
      }
      let prices = byWorld.get(row.world_id);
      if (!prices) {
        prices = [];
        byWorld.set(row.world_id, prices);
      }
      prices.push(row.price_per_unit);
    }

    const batchSize = 250;
    const allBargains: BargainListing[] = [];
    const itemCache = new Map<number, ItemDetails>();

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

        const worldSales = salesByItemWorld.get(row.item_id);
        if (!worldSales) continue;

        const dcPrices = new Map<string, number[]>();
        for (const [worldId, prices] of worldSales) {
          const dc = this.worldDataCenters[worldId];
          if (!dc) continue;
          let arr = dcPrices.get(dc);
          if (!arr) {
            arr = [];
            dcPrices.set(dc, arr);
          }
          arr.push(...prices);
        }

        const dcAvg = new Map<string, number>();
        for (const [dc, prices] of dcPrices) {
          const avg = iqrAverage(prices);
          if (avg !== null && prices.length >= 7) dcAvg.set(dc, avg);
        }

        const allPrices = [...worldSales.values()].flat();
        const globalIqr = iqrAverage(allPrices);

        let item = itemCache.get(row.item_id);
        if (!item) {
          try {
            item = await this.xivapi.getItemDetails(row.item_id);
            itemCache.set(row.item_id, item);
          } catch {
            item = { id: row.item_id, name: `Item ${row.item_id}` };
          }
        }

        for (const listing of itemListings) {
          if (!listing.pricePerUnit || listing.pricePerUnit <= 0) continue;
          const worldId = listing.worldID ?? 0;
          const dc = this.worldDataCenters[worldId] ?? "Unknown";
          const avg = dcAvg.get(dc) ?? globalIqr ?? 0;
          if (avg <= 0) continue;

          const discount = avg - listing.pricePerUnit;
          if (discount <= 0) continue;

          allBargains.push({
            itemId: row.item_id,
            item,
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
