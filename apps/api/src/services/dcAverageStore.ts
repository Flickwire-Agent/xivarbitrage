import { config } from "../config.js";
import pool from "../db/pool.js";
import { UniversalisClient } from "./universalis.js";
import { iqrAverage, type DcItemAverage } from "./stats.js";

const MIN_SALES_PER_DC = 7;
const RECOMPUTE_INTERVAL_MS = 60 * 60 * 1000;

export class DcAverageStore {
  private universalis = new UniversalisClient();
  private worldDataCenters: Record<number, string> = {};
  private dcRegions: Record<string, string> = {};
  private computePromise: Promise<void> | null = null;
  private lastCompute: number = 0;

  constructor() {}

  start() {
    void this.recompute();
    setInterval(() => void this.recompute(), RECOMPUTE_INTERVAL_MS).unref();
  }

  async recompute(): Promise<void> {
    if (this.computePromise) return this.computePromise;
    if (Date.now() - this.lastCompute < RECOMPUTE_INTERVAL_MS / 2) return;

    this.computePromise = this.compute()
      .catch((error) => {
        console.error(`[DcAverageStore] Error: ${error}`);
      })
      .finally(() => {
        this.computePromise = null;
      });
    return this.computePromise;
  }

  private async ensureMapping(): Promise<void> {
    if (Object.keys(this.worldDataCenters).length > 0) return;
    const dcs = await this.universalis.getDataCenters();
    for (const dc of dcs) {
      for (const wid of dc.worlds) {
        this.worldDataCenters[wid] = dc.name;
      }
      this.dcRegions[dc.name] = dc.region;
    }
  }

  private async compute(): Promise<void> {
    if (!config.databaseUrl) return;
    console.log("[DcAverageStore] Recomputing DC averages...");
    await this.ensureMapping();

    const computeStart = new Date();

    const itemResult = await pool.query<{ item_id: number }>(
      `SELECT DISTINCT item_id
       FROM sale_history
       WHERE sold_at > now() - interval '30 days'
       LIMIT 3000`,
    );
    if (itemResult.rows.length === 0) {
      this.lastCompute = Date.now();
      return;
    }

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

    const averages: DcItemAverage[] = [];
    for (const [itemId, worldSales] of salesByItemWorld) {
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

      for (const [dc, prices] of dcPrices) {
        const avg = iqrAverage(prices);
        if (avg !== null && prices.length >= MIN_SALES_PER_DC) {
          averages.push({
            itemId,
            dataCenter: dc,
            region: this.dcRegions[dc] ?? "Unknown",
            avgPrice: avg,
            saleCount: prices.length,
          });
        }
      }
    }

    for (let i = 0; i < averages.length; i += 500) {
      const batch = averages.slice(i, i + 500);
      const values = batch.map(
        (_, j) =>
          `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5}, now())`,
      );
      const params: unknown[] = [];
      for (const a of batch) {
        params.push(a.itemId, a.dataCenter, a.region, a.avgPrice, a.saleCount);
      }
      await pool.query(
        `INSERT INTO dc_item_averages (item_id, data_center, region, avg_price, sale_count, computed_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (item_id, data_center) DO UPDATE SET
           avg_price = EXCLUDED.avg_price,
           region = EXCLUDED.region,
           sale_count = EXCLUDED.sale_count,
           computed_at = now()`,
        params,
      );
    }

    await pool.query("DELETE FROM dc_item_averages WHERE computed_at < $1", [computeStart]);

    this.lastCompute = Date.now();
    console.log(
      `[DcAverageStore] Stored ${averages.length} DC averages for ${salesByItemWorld.size} items`,
    );
  }

  async getAverages(): Promise<DcItemAverage[]> {
    if (!config.databaseUrl) return [];
    const result = await pool.query<{
      item_id: number;
      data_center: string;
      region: string;
      avg_price: number;
      sale_count: number;
    }>("SELECT item_id, data_center, region, avg_price, sale_count FROM dc_item_averages");
    return result.rows.map((r) => ({
      itemId: r.item_id,
      dataCenter: r.data_center,
      region: r.region,
      avgPrice: r.avg_price,
      saleCount: r.sale_count,
    }));
  }
}

export const dcAverageStore = new DcAverageStore();
