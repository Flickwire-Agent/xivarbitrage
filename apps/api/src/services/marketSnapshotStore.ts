import pg from "pg";
import { config } from "../config.js";
import type { UniversalisMarketData } from "./universalis.js";
import type { SaleRecord } from "@xiv-arbitrage/shared";

const { Pool } = pg;

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
  private readonly pool = config.databaseUrl
    ? new Pool({
        connectionString: config.databaseUrl,
        ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
      })
    : null;
  private initialized: Promise<void> | null = null;

  get isEnabled() {
    return this.pool !== null;
  }

  async init(): Promise<void> {
    if (!this.pool) {
      return;
    }

    this.initialized ??= this.pool
      .query(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        item_id integer NOT NULL,
        region text NOT NULL,
        data jsonb NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, region)
      );

      CREATE INDEX IF NOT EXISTS market_snapshots_fetched_at_idx
        ON market_snapshots (fetched_at);

      CREATE TABLE IF NOT EXISTS sale_history (
        id bigserial,
        item_id integer NOT NULL,
        world_id integer NOT NULL,
        world_name text,
        price_per_unit integer NOT NULL,
        quantity integer NOT NULL,
        sold_at timestamptz NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS sale_history_item_sold_idx
        ON sale_history (item_id, sold_at DESC);

      CREATE INDEX IF NOT EXISTS sale_history_item_world_idx
        ON sale_history (item_id, world_id);

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'sale_history_unique_sale'
        ) THEN
          ALTER TABLE sale_history ADD CONSTRAINT sale_history_unique_sale
            UNIQUE (item_id, world_id, price_per_unit, sold_at);
        END IF;
      END $$;
    `)
      .then(() => undefined);

    await this.initialized;
  }

  async getFresh(region: string, itemId: number): Promise<UniversalisMarketData | null> {
    if (!this.pool) {
      return null;
    }

    await this.init();
    const result = await this.pool.query<SnapshotRow>(
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
    if (!this.pool) {
      return;
    }

    await this.init();
    await this.pool.query(
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
    if (!this.pool || !data.recentHistory?.length) {
      return;
    }

    await this.init();

    // De-duplicate within a single Universalis response (unlikely but safe)
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

    // Batch upsert using UNIQUE constraint on (item_id, world_id, price_per_unit, sold_at).
    // On conflict, update world_name in case it drifted (e.g. server rename).
    const placeholders = values.map((_, i) => {
      const base = i * 6;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    const params = values.flatMap((v) => [
      v.itemId,
      v.worldId,
      v.worldName,
      v.price,
      v.qty,
      v.soldAt,
    ]);

    await this.pool.query(
      `
        INSERT INTO sale_history (item_id, world_id, world_name, price_per_unit, quantity, sold_at)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (item_id, world_id, price_per_unit, sold_at)
        DO UPDATE SET world_name = EXCLUDED.world_name
      `,
      params,
    );
  }

  async getSaleHistory(itemId: number): Promise<SaleRecord[]> {
    if (!this.pool) return [];

    await this.init();
    const result = await this.pool.query<SaleRow>(
      `
        SELECT world_id, world_name, price_per_unit, quantity, sold_at
        FROM sale_history
        WHERE item_id = $1
          AND sold_at > now() - interval '14 days'
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
    if (!this.pool) return { listings: [], sales: [], saleStats: { count: 0 } };

    await this.init();

    const [snapshotResult, saleRecordsResult] = await Promise.all([
      this.pool.query<{ data: UniversalisMarketData }>(
        `SELECT data FROM market_snapshots WHERE item_id = $1 ORDER BY fetched_at DESC LIMIT 1`,
        [itemId],
      ),
      this.pool.query<{ world_id: number; price_per_unit: number }>(
        `SELECT world_id, price_per_unit
         FROM sale_history
         WHERE item_id = $1 AND sold_at > now() - interval '14 days'`,
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
    if (!this.pool) return 0;

    await this.init();
    const result = await this.pool.query(
      `DELETE FROM sale_history WHERE sold_at < now() - interval '14 days'`,
    );

    return result.rowCount ?? 0;
  }

  async deleteStale(): Promise<number> {
    if (!this.pool) {
      return 0;
    }

    await this.init();
    const result = await this.pool.query(
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
