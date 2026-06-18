import type {
  DcDisparity,
  DcDisparityQuery,
  DcPriceInfo,
  ItemDetails,
} from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import pg from "pg";
import { XivApiClient } from "./xivapi.js";
import { dcAverageStore } from "./dcAverageStore.js";
import type { DcItemAverage } from "./stats.js";

const { Pool } = pg;

export class DcDisparityCache {
  private latest: DcDisparity[] = [];
  private generatedAt = "";
  private refreshPromise: Promise<void> | null = null;
  private pool: pg.Pool | null;
  private xivapi = new XivApiClient();

  constructor() {
    this.pool = config.databaseUrl
      ? new Pool({
          connectionString: config.databaseUrl,
          ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
        })
      : null;
  }

  start() {
    void this.refresh();
    setInterval(() => void this.refresh(), config.arbitrageRefreshMinutes * 60 * 1000).unref();
  }

  async get(query?: DcDisparityQuery): Promise<{
    generatedAt: string;
    disparities: DcDisparity[];
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
  }> {
    if (this.latest.length === 0) await this.refresh();

    let filtered = this.latest;

    if (query) {
      if (query.highDc) {
        const h = query.highDc.toLowerCase();
        filtered = filtered.filter((d) => d.highDc.dataCenter.toLowerCase().includes(h));
      }
      if (query.lowDc) {
        const l = query.lowDc.toLowerCase();
        filtered = filtered.filter((d) => d.lowDc.dataCenter.toLowerCase().includes(l));
      }
      if (query.region) {
        const r = query.region.toLowerCase();
        filtered = filtered.filter((d) =>
          d.allDcs.some((dc) => dc.region.toLowerCase().includes(r)),
        );
      }
      if (query.minSpread !== undefined) {
        filtered = filtered.filter((d) => d.spread >= query.minSpread!);
      }
      if (query.minSpreadPercent !== undefined) {
        filtered = filtered.filter((d) => d.spreadPercent >= query.minSpreadPercent!);
      }

      if (query.sort === "spreadPercent") {
        filtered.sort((a, b) => b.spreadPercent - a.spreadPercent);
      } else if (query.sort === "item") {
        filtered.sort((a, b) => a.item.name.localeCompare(b.item.name));
      } else {
        filtered.sort((a, b) => b.spread - a.spread);
      }
    }

    const page = Math.max(1, query?.page ?? 1);
    const perPage = Math.max(1, Math.min(200, query?.perPage ?? 50));
    const total = filtered.length;
    const totalPages = Math.ceil(total / perPage);
    const start = (page - 1) * perPage;
    const disparities = filtered.slice(start, start + perPage);

    return { generatedAt: this.generatedAt, disparities, total, page, perPage, totalPages };
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.scan()
      .then((disparities) => {
        this.latest = disparities;
        this.generatedAt = new Date().toISOString();
        console.log(`[DcDisparityCache] Refreshed with ${disparities.length} disparities`);
      })
      .catch((error) => {
        console.error(`[DcDisparityCache] Error refreshing: ${error}`);
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }

  private async scan(): Promise<DcDisparity[]> {
    console.log("[DcDisparityCache] Starting scan...");

    let averages = await dcAverageStore.getAverages();
    if (averages.length === 0) {
      console.log("[DcDisparityCache] No averages available, triggering recompute...");
      await dcAverageStore.recompute();
      averages = await dcAverageStore.getAverages();
      if (averages.length === 0) {
        console.log("[DcDisparityCache] Still no averages after recompute");
        return [];
      }
    }

    const byItem = new Map<number, DcItemAverage[]>();
    for (const a of averages) {
      let arr = byItem.get(a.itemId);
      if (!arr) {
        arr = [];
        byItem.set(a.itemId, arr);
      }
      arr.push(a);
    }

    console.log(`[DcDisparityCache] Loaded averages for ${byItem.size} items`);

    const allDisparities: DcDisparity[] = [];
    const itemCache = new Map<number, ItemDetails>();
    let candidatesFound = 0;

    for (const [itemId, dcAverages] of byItem) {
      if (dcAverages.length < 2) continue;
      candidatesFound++;

      let highDc = "";
      let lowDc = "";
      let highAvg = 0;
      let lowAvg = Infinity;

      for (const { dataCenter, avgPrice } of dcAverages) {
        if (avgPrice > highAvg) {
          highAvg = avgPrice;
          highDc = dataCenter;
        }
        if (avgPrice < lowAvg) {
          lowAvg = avgPrice;
          lowDc = dataCenter;
        }
      }

      const spread = highAvg - lowAvg;
      const spreadPercent = lowAvg > 0 ? Math.round((spread / lowAvg) * 100) : 0;

      const allDcs: DcPriceInfo[] = dcAverages
        .map((a) => ({
          dataCenter: a.dataCenter,
          region: a.region,
          avgPrice: a.avgPrice,
          saleCount: a.saleCount,
        }))
        .sort((a, b) => b.avgPrice - a.avgPrice);

      let item = itemCache.get(itemId);
      if (!item) {
        try {
          item = await this.xivapi.getItemDetails(itemId);
          itemCache.set(itemId, item);
        } catch {
          item = { id: itemId, name: `Item ${itemId}` };
        }
      }

      allDisparities.push({
        itemId,
        item,
        spread,
        spreadPercent,
        highDc: {
          dataCenter: highDc,
          region: dcAverages.find((a) => a.dataCenter === highDc)!.region,
          avgPrice: highAvg,
          saleCount: dcAverages.find((a) => a.dataCenter === highDc)!.saleCount,
        },
        lowDc: {
          dataCenter: lowDc,
          region: dcAverages.find((a) => a.dataCenter === lowDc)!.region,
          avgPrice: lowAvg,
          saleCount: dcAverages.find((a) => a.dataCenter === lowDc)!.saleCount,
        },
        allDcs,
      });
    }

    console.log(
      `[DcDisparityCache] Processed ${byItem.size} items, ${candidatesFound} had multi-DC data, ${allDisparities.length} results after sorting`,
    );

    allDisparities.sort((a, b) => b.spread - a.spread);
    return allDisparities;
  }
}

export const dcDisparityCache = new DcDisparityCache();
