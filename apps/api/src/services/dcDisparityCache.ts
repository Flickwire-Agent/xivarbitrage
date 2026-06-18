import type { DcDisparity, DcDisparityQuery } from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import { dcAverageStore } from "./dcAverageStore.js";
import pool from "../db/pool.js";
import type { DcItemAverage } from "./stats.js";

export class DcDisparityCache {
  private latest: DcDisparity[] = [];
  private generatedAt = "";
  private hasLoaded = false;
  private refreshPromise: Promise<void> | null = null;

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
    const disparities = filtered.slice(start, start + perPage);

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

    let allItemIds: number[];
    if (config.databaseUrl) {
      const result = await pool.query<{ item_id: number }>(
        `SELECT item_id FROM marketable_items ORDER BY item_id`,
      );
      allItemIds = result.rows.map((r) => r.item_id);
    } else {
      allItemIds = [...byItem.keys()];
    }

    console.log(`[DcDisparityCache] Total marketable items: ${allItemIds.length}`);

    const allDisparities: DcDisparity[] = [];

    for (const itemId of allItemIds) {
      const dcAverages = byItem.get(itemId);

      if (!dcAverages || dcAverages.length < 2) {
        if (dcAverages?.length === 1) {
          const single = dcAverages[0]!;
          allDisparities.push({
            itemId,
            spread: 0,
            spreadPercent: 0,
            highDc: {
              dataCenter: single.dataCenter,
              region: single.region,
              avgPrice: single.avgPrice,
              saleCount: single.saleCount,
            },
            lowDc: {
              dataCenter: single.dataCenter,
              region: single.region,
              avgPrice: single.avgPrice,
              saleCount: single.saleCount,
            },
            allDcs: [
              {
                dataCenter: single.dataCenter,
                region: single.region,
                avgPrice: single.avgPrice,
                saleCount: single.saleCount,
              },
            ],
          });
        } else {
          allDisparities.push({
            itemId,
            spread: 0,
            spreadPercent: 0,
            highDc: {
              dataCenter: "—",
              region: "—",
              avgPrice: 0,
              saleCount: 0,
            },
            lowDc: {
              dataCenter: "—",
              region: "—",
              avgPrice: 0,
              saleCount: 0,
            },
            allDcs: [],
          });
        }
        continue;
      }

      const sorted = [...dcAverages].sort((a, b) => b.avgPrice - a.avgPrice);
      const highDc = sorted.at(0)!;
      const lowDc = sorted.at(-1)!;
      const secondHighDc = sorted.length > 1 ? sorted.at(1) : null;
      const secondLowDc = sorted.length > 1 ? sorted.at(-2) : null;

      const spread = highDc.avgPrice - lowDc.avgPrice;
      const spreadPercent = lowDc.avgPrice > 0 ? Math.round((spread / lowDc.avgPrice) * 100) : 0;

      // Wash-trade / outlier guard: downgrade to single-DC (the DC with the most
      // sales) when the spread is unreliable. Three heuristics detect this:
      //   1) price ratio >=10x between high and low AND either side has <5 sales
      //   2) high DC avg is >=10x the second-highest DC (cross-DC inconsistency)
      //   3) low DC avg is <=1/10th the second-lowest DC (cross-DC inconsistency)
      const MAX_REASONABLE_RATIO = 10;
      const priceRatio = lowDc.avgPrice > 0 ? highDc.avgPrice / lowDc.avgPrice : Infinity;
      const highVsSecond =
        secondHighDc && secondHighDc.avgPrice > 0 ? highDc.avgPrice / secondHighDc.avgPrice : 0;
      const lowVsSecond =
        secondLowDc && lowDc.avgPrice > 0 ? secondLowDc.avgPrice / lowDc.avgPrice : 0;

      const isUnreliable =
        (priceRatio >= MAX_REASONABLE_RATIO && (highDc.saleCount < 5 || lowDc.saleCount < 5)) ||
        highVsSecond >= MAX_REASONABLE_RATIO ||
        lowVsSecond >= MAX_REASONABLE_RATIO;

      if (isUnreliable) {
        const bestDc = sorted.reduce((best, dc) => (dc.saleCount > best.saleCount ? dc : best));
        allDisparities.push({
          itemId,
          spread: 0,
          spreadPercent: 0,
          highDc: {
            dataCenter: bestDc.dataCenter,
            region: bestDc.region,
            avgPrice: bestDc.avgPrice,
            saleCount: bestDc.saleCount,
          },
          lowDc: {
            dataCenter: bestDc.dataCenter,
            region: bestDc.region,
            avgPrice: bestDc.avgPrice,
            saleCount: bestDc.saleCount,
          },
          allDcs: sorted.map((a) => ({
            dataCenter: a.dataCenter,
            region: a.region,
            avgPrice: a.avgPrice,
            saleCount: a.saleCount,
          })),
        });
        continue;
      }

      allDisparities.push({
        itemId,
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
        allDcs: sorted.map((a) => ({
          dataCenter: a.dataCenter,
          region: a.region,
          avgPrice: a.avgPrice,
          saleCount: a.saleCount,
        })),
      });
    }

    console.log(
      `[DcDisparityCache] Processed ${allItemIds.length} total items, ${allDisparities.length} results in ${Date.now() - startedAt}ms`,
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
    return [...filtered].sort((a, b) => b.spread - a.spread);
  }
}

export const dcDisparityCache = new DcDisparityCache();
