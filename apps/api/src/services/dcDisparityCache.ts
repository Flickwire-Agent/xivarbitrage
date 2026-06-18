import type {
  DcDisparity,
  DcDisparityQuery,
  DcPriceInfo,
  ItemDetails,
} from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import { XivApiClient } from "./xivapi.js";
import { dcAverageStore } from "./dcAverageStore.js";
import type { DcItemAverage } from "./stats.js";

const ITEM_HYDRATION_CONCURRENCY = 10;

export class DcDisparityCache {
  private latest: DcDisparity[] = [];
  private generatedAt = "";
  private hasLoaded = false;
  private refreshPromise: Promise<void> | null = null;
  private xivapi = new XivApiClient();

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
    if (!this.hasLoaded) await this.refresh();

    const filtered = this.filterAndSort(query);

    const page = Math.max(1, query?.page ?? 1);
    const perPage = Math.max(1, Math.min(200, query?.perPage ?? 50));
    const total = filtered.length;
    const totalPages = Math.ceil(total / perPage);
    const start = (page - 1) * perPage;
    const disparities = await this.hydrateItems(filtered.slice(start, start + perPage));

    return { generatedAt: this.generatedAt, disparities, total, page, perPage, totalPages };
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.scan()
      .then((disparities) => {
        this.latest = disparities;
        this.generatedAt = new Date().toISOString();
        this.hasLoaded = true;
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
    const startedAt = Date.now();
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
    let candidatesFound = 0;

    for (const [itemId, dcAverages] of byItem) {
      if (dcAverages.length < 2) continue;
      candidatesFound++;

      let highDc: DcItemAverage | null = null;
      let lowDc: DcItemAverage | null = null;

      for (const dcAverage of dcAverages) {
        if (!highDc || dcAverage.avgPrice > highDc.avgPrice) {
          highDc = dcAverage;
        }
        if (!lowDc || dcAverage.avgPrice < lowDc.avgPrice) {
          lowDc = dcAverage;
        }
      }

      if (!highDc || !lowDc) continue;

      const spread = highDc.avgPrice - lowDc.avgPrice;
      const spreadPercent = lowDc.avgPrice > 0 ? Math.round((spread / lowDc.avgPrice) * 100) : 0;

      const allDcs: DcPriceInfo[] = dcAverages
        .map((a) => ({
          dataCenter: a.dataCenter,
          region: a.region,
          avgPrice: a.avgPrice,
          saleCount: a.saleCount,
        }))
        .sort((a, b) => b.avgPrice - a.avgPrice);

      allDisparities.push({
        itemId,
        item: this.placeholderItem(itemId),
        spread,
        spreadPercent,
        highDc: {
          dataCenter: highDc.dataCenter,
          region: highDc.region,
          avgPrice: highDc.avgPrice,
          saleCount: highDc.saleCount,
        },
        lowDc: {
          dataCenter: lowDc.dataCenter,
          region: lowDc.region,
          avgPrice: lowDc.avgPrice,
          saleCount: lowDc.saleCount,
        },
        allDcs,
      });
    }

    console.log(
      `[DcDisparityCache] Processed ${byItem.size} items, ${candidatesFound} had multi-DC data, ${allDisparities.length} results after sorting in ${Date.now() - startedAt}ms`,
    );

    allDisparities.sort((a, b) => b.spread - a.spread);
    return allDisparities;
  }

  private filterAndSort(query?: DcDisparityQuery): DcDisparity[] {
    let filtered = this.latest;

    if (query?.highDc) {
      const h = query.highDc.toLowerCase();
      filtered = filtered.filter((d) => d.highDc.dataCenter.toLowerCase().includes(h));
    }
    if (query?.lowDc) {
      const l = query.lowDc.toLowerCase();
      filtered = filtered.filter((d) => d.lowDc.dataCenter.toLowerCase().includes(l));
    }
    if (query?.region) {
      const r = query.region.toLowerCase();
      filtered = filtered.filter((d) => d.allDcs.some((dc) => dc.region.toLowerCase().includes(r)));
    }
    if (query?.minSpread !== undefined) {
      filtered = filtered.filter((d) => d.spread >= query.minSpread!);
    }
    if (query?.minSpreadPercent !== undefined) {
      filtered = filtered.filter((d) => d.spreadPercent >= query.minSpreadPercent!);
    }

    if (query?.sort === "spreadPercent") {
      return [...filtered].sort((a, b) => b.spreadPercent - a.spreadPercent);
    }
    if (query?.sort === "item") {
      return [...filtered].sort((a, b) => a.item.name.localeCompare(b.item.name));
    }
    return [...filtered].sort((a, b) => b.spread - a.spread);
  }

  private async hydrateItems(disparities: DcDisparity[]): Promise<DcDisparity[]> {
    if (disparities.length === 0) return disparities;

    const startedAt = Date.now();
    const hydrated = disparities.slice();
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(ITEM_HYDRATION_CONCURRENCY, disparities.length) },
      async () => {
        while (nextIndex < disparities.length) {
          const currentIndex = nextIndex++;
          const disparity = disparities[currentIndex];
          if (!disparity) continue;

          try {
            disparity.item = await this.xivapi.getItemDetails(disparity.itemId);
            hydrated[currentIndex] = disparity;
          } catch {
            hydrated[currentIndex] = disparity;
          }
        }
      },
    );

    await Promise.all(workers);
    const elapsed = Date.now() - startedAt;
    if (elapsed > 1000) {
      console.log(`[DcDisparityCache] Hydrated ${disparities.length} item details in ${elapsed}ms`);
    }
    return hydrated;
  }

  private placeholderItem(itemId: number): ItemDetails {
    return { id: itemId, name: `Item ${itemId}` };
  }
}

export const dcDisparityCache = new DcDisparityCache();
