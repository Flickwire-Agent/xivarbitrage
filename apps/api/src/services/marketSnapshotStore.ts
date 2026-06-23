import { pool } from "../db/pool.js";
import { config } from "../config.js";
import type { UniversalisMarketData } from "./universalis.js";
import type { SaleRecord } from "@xiv-arbitrage/shared";

interface SnapshotRow {
  data: UniversalisMarketData;
  fetched_at: Date;
}

interface SaleRow {
  world_id: number;
  world_name: string;
  price_per_unit: number;
  quantity: number;
  sold_at: Date;
}

export class MarketSnapshotStore {
  get isEnabled() {
    return pool !== null;
  }

  async getFresh(region: string, itemId: number): Promise<UniversalisMarketData | null> {
    if (!pool) {
      return null;
    }

    const result = await pool.query<SnapshotRow>(
      `
        SELECT data, fetched_at
        FROM market_snapshots
        WHERE item_id = $1
          AND region = $2
          AND fetched_at > now() - ($3::text)::interval
      `,
      [itemId, region, `${config.marketSnapshotFreshHours} hours`],
    );

    return result.rows[0]?.data ?? null;
  }

  async upsert(region: string, itemId: number, data: UniversalisMarketData): Promise<void> {
    if (!pool) {
      return;
    }

    await pool.query(
      `
        INSERT INTO market_snapshots (item_id, region, data, fetched_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (item_id, region)
        DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at
      `,
      [itemId, region, data],
    );
  }

  async storeSales(itemId: number, data: UniversalisMarketData): Promise<void> {
    if (!pool || !data.recentHistory?.length) {
      return;
    }

    const seen = new Set<string>();
    const values: {
      itemId: number;
      worldId: number;
      worldName: string;
      price: number;
      qty: number;
      soldAt: Date;
    }[] = [];

    for (const sale of data.recentHistory) {
      if (!sale.worldID || !sale.timestamp) continue;

      const key = `${itemId}:${sale.worldID}:${sale.pricePerUnit}:${sale.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);

      values.push({
        itemId,
        worldId: sale.worldID,
        worldName: sale.worldName ?? "",
        price: sale.pricePerUnit,
        qty: sale.quantity,
        soldAt: new Date(sale.timestamp * 1000),
      });
    }

    if (values.length === 0) return;

    const soldTimes = values.map((value) => value.soldAt.getTime());
    const existingResult = await pool.query<{
      world_id: number;
      price_per_unit: number;
      sold_at: Date;
    }>(
      `
        SELECT world_id, price_per_unit, sold_at
        FROM sale_history
        WHERE item_id = $1
          AND sold_at BETWEEN $2 AND $3
      `,
      [itemId, new Date(Math.min(...soldTimes)), new Date(Math.max(...soldTimes))],
    );

    const existingKeys = new Set(
      existingResult.rows.map(
        (row) =>
          `${itemId}:${row.world_id}:${row.price_per_unit}:${Math.floor(row.sold_at.getTime() / 1000)}`,
      ),
    );
    const newValues = values.filter(
      (value) =>
        !existingKeys.has(
          `${itemId}:${value.worldId}:${value.price}:${Math.floor(value.soldAt.getTime() / 1000)}`,
        ),
    );

    if (newValues.length === 0) return;

    const placeholders = newValues.map((_, i) => {
      const base = i * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    const params = newValues.flatMap((v) => [
      v.itemId,
      v.worldId,
      v.worldName,
      v.price,
      v.qty,
      v.soldAt,
    ]);

    await pool.query(
      `
        INSERT INTO sale_history (item_id, world_id, world_name, price_per_unit, quantity, sold_at)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (item_id, world_id, price_per_unit, sold_at)
        DO NOTHING
      `,
      params,
    );
  }

  async getSaleHistory(itemId: number): Promise<SaleRecord[]> {
    if (!pool) return [];

    const result = await pool.query<SaleRow>(
      `
        SELECT world_id, world_name, price_per_unit, quantity, sold_at
        FROM sale_history
        WHERE item_id = $1
           AND sold_at > now() - interval '30 days'
        ORDER BY sold_at ASC
      `,
      [itemId],
    );

    return result.rows.map((row) => ({
      worldId: row.world_id,
      worldName: row.world_name,
      pricePerUnit: row.price_per_unit,
      quantity: row.quantity,
      soldAt: row.sold_at.toISOString(),
    }));
  }

  async getCurrentListings(itemId: number): Promise<{
    listings: { worldId: number; worldName: string; pricePerUnit: number; quantity: number }[];
    sales: { worldId: number; pricePerUnit: number }[];
    saleStats: { count: number };
  }> {
    if (!pool) return { listings: [], sales: [], saleStats: { count: 0 } };

    const [snapshotResult, saleRecordsResult] = await Promise.all([
      pool.query<{ data: UniversalisMarketData }>(
        `SELECT data FROM market_snapshots WHERE item_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
        [itemId],
      ),
      pool.query<{ world_id: number; price_per_unit: number }>(
        `SELECT world_id, price_per_unit
         FROM sale_history
         WHERE item_id = $1 AND sold_at > now() - interval '30 days'`,
        [itemId],
      ),
    ]);

    const data = snapshotResult.rows[0]?.data;
    if (!data?.listings) return { listings: [], sales: [], saleStats: { count: 0 } };

    return {
      listings: data.listings
        .filter((l) => l.pricePerUnit > 0)
        .map((l) => ({
          worldId: l.worldID ?? 0,
          worldName: l.worldName ?? "Unknown",
          pricePerUnit: l.pricePerUnit,
          quantity: l.quantity,
        })),
      sales: saleRecordsResult.rows.map((r) => ({
        worldId: r.world_id,
        pricePerUnit: r.price_per_unit,
      })),
      saleStats: { count: saleRecordsResult.rows.length },
    };
  }

  async pruneOldSales(): Promise<number> {
    if (!pool) return 0;

    const result = await pool.query(
      `DELETE FROM sale_history WHERE sold_at < now() - interval '30 days'`,
    );

    return result.rowCount ?? 0;
  }

  async deleteStale(): Promise<number> {
    if (!pool) {
      return 0;
    }

    const result = await pool.query(
      `
        DELETE FROM market_snapshots
        WHERE fetched_at < now() - ($1::text)::interval
      `,
      [`${config.marketSnapshotRetentionDays} days`],
    );

    return result.rowCount ?? 0;
  }
}

export const marketSnapshotStore = new MarketSnapshotStore();
