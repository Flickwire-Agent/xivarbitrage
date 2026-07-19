import { pool } from "./pool.js";

export async function runMigrations(): Promise<void> {
  if (!pool) {
    console.log("No database configured, skipping migrations");
    return;
  }

  console.log("Starting database migrations...");

  await pool.query(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        item_id integer NOT NULL,
        region text NOT NULL,
        data jsonb NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, region)
      );
    `);
  console.log("✓ Created market_snapshots table");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS market_snapshots_fetched_at_idx
        ON market_snapshots (fetched_at);
    `);
  console.log("✓ Created index on market_snapshots (fetched_at)");

  await pool.query(`
      CREATE TABLE IF NOT EXISTS marketable_items (
        item_id integer PRIMARY KEY,
        last_scanned timestamptz,
        priority integer DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  console.log("✓ Created marketable_items table");

  await pool.query(`
      CREATE TABLE IF NOT EXISTS job_history (
        id serial PRIMARY KEY,
        job_id text NOT NULL,
        item_id integer NOT NULL,
        region text NOT NULL,
        status text NOT NULL,
        error_message text,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  console.log("✓ Created job_history table");

  await pool.query(`DROP INDEX IF EXISTS job_history_status_idx`);
  console.log("✓ Dropped unused job_history_status_idx");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS job_history_created_at_idx
        ON job_history (created_at, status);
    `);
  console.log("✓ Created index on job_history (created_at, status)");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS marketable_items_last_scanned_idx
        ON marketable_items (last_scanned NULLS FIRST);
    `);
  console.log("✓ Created index on marketable_items (last_scanned)");

  await pool.query(`
      CREATE TABLE IF NOT EXISTS item_region_scan_state (
        item_id integer NOT NULL REFERENCES marketable_items(item_id) ON DELETE CASCADE,
        region text NOT NULL,
        last_scanned timestamptz,
        next_scan_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'pending',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, region)
      );
    `);
  console.log("✓ Created item_region_scan_state table");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS item_region_scan_state_due_idx
        ON item_region_scan_state (next_scan_at, status);
    `);
  console.log("✓ Created index on item_region_scan_state (next_scan_at, status)");

  await pool.query(`
      CREATE TABLE IF NOT EXISTS sale_history (
        id bigserial PRIMARY KEY,
        item_id integer NOT NULL,
        world_id integer NOT NULL,
        world_name text,
        price_per_unit integer NOT NULL,
        quantity integer NOT NULL,
        sold_at timestamptz NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  console.log("✓ Created sale_history table");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS sale_history_item_sold_idx
        ON sale_history (item_id, sold_at DESC);
    `);
  console.log("✓ Created index on sale_history (item_id, sold_at)");

  await pool.query(`DROP INDEX IF EXISTS sale_history_item_world_idx`);
  console.log("✓ Dropped redundant sale_history_item_world_idx");

  await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS sale_history_item_sold_world_price_idx
        ON sale_history (item_id, sold_at DESC, world_id) INCLUDE (price_per_unit);
    `);
  console.log("✓ Created covering index on sale_history for DC average recompute");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS sale_history_sold_at_idx
        ON sale_history (sold_at);
    `);
  console.log("✓ Created index on sale_history (sold_at)");

  await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'sale_history_unique_sale'
        ) THEN
          ALTER TABLE sale_history ADD CONSTRAINT sale_history_unique_sale
            UNIQUE (item_id, world_id, price_per_unit, sold_at);
        END IF;
      END $$;
    `);
  console.log(
    "✓ Added unique constraint on sale_history (item_id, world_id, price_per_unit, sold_at)",
  );

  await pool.query(`
      CREATE TABLE IF NOT EXISTS dc_item_averages (
        item_id integer NOT NULL,
        data_center text NOT NULL,
        region text NOT NULL,
        avg_price integer NOT NULL,
        sale_count integer NOT NULL,
        computed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, data_center)
      );
    `);
  console.log("✓ Created dc_item_averages table");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_dc_item_averages_computed
        ON dc_item_averages (computed_at);
    `);
  console.log("✓ Created index on dc_item_averages (computed_at)");

  await pool.query(`
      CREATE TABLE IF NOT EXISTS xivapi_cache (
        cache_key text PRIMARY KEY,
        data jsonb NOT NULL,
        category text NOT NULL DEFAULT 'item',
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
    `);
  console.log("✓ Created xivapi_cache table");

  await pool.query(`
      CREATE INDEX IF NOT EXISTS xivapi_cache_expires_idx
        ON xivapi_cache (expires_at);
    `);
  console.log("✓ Created index on xivapi_cache (expires_at)");

  console.log("Database migrations completed successfully");
}
