import pg from "pg";

const { Pool } = pg;

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }
  });

  try {
    console.log("Starting database migrations...");

    // Create market_snapshots table
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

    // Create index on fetched_at for cleanup queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS market_snapshots_fetched_at_idx
        ON market_snapshots (fetched_at);
    `);
    console.log("✓ Created index on market_snapshots (fetched_at)");

    // Create marketable_items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketable_items (
        item_id integer PRIMARY KEY,
        last_scanned timestamptz,
        priority integer DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    console.log("✓ Created marketable_items table");

    // Create job_history table
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

    // Index for job_history queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS job_history_status_idx
        ON job_history (status, completed_at DESC);
    `);
    console.log("✓ Created index on job_history (status, completed_at)");

    // Index for finding items by last_scanned
    await pool.query(`
      CREATE INDEX IF NOT EXISTS marketable_items_last_scanned_idx
        ON marketable_items (last_scanned NULLS FIRST);
    `);
    console.log("✓ Created index on marketable_items (last_scanned)");

    console.log("Database migrations completed successfully");
  } finally {
    await pool.end();
  }
}

