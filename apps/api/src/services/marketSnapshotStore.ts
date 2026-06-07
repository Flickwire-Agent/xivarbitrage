import pg from "pg";
import { config } from "../config.js";
import type { UniversalisMarketData } from "./universalis.js";

const { Pool } = pg;

interface SnapshotRow {
  data: UniversalisMarketData;
  fetched_at: Date;
}

export class MarketSnapshotStore {
  private readonly pool = config.databaseUrl
    ? new Pool({
        connectionString: config.databaseUrl,
        ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false }
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

    this.initialized ??= this.pool.query(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        item_id integer NOT NULL,
        region text NOT NULL,
        data jsonb NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, region)
      );

      CREATE INDEX IF NOT EXISTS market_snapshots_fetched_at_idx
        ON market_snapshots (fetched_at);
    `).then(() => undefined);

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
      [itemId, region, `${config.marketSnapshotFreshHours} hours`]
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
      [itemId, region, data]
    );
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
      [`${config.marketSnapshotRetentionDays} days`]
    );

    return result.rowCount ?? 0;
  }
}

export const marketSnapshotStore = new MarketSnapshotStore();
