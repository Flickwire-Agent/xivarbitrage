import pg from "pg";

const { Pool } = pg;

async function resetDatabase(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  try {
    console.log("Starting database reset...\n");

    // Drop existing tables in dependency order (children before parents)
    console.log("Dropping existing tables...");

    await pool.query(`DROP TABLE IF EXISTS job_history;`);
    console.log("✓ Dropped job_history");

    await pool.query(`DROP TABLE IF EXISTS market_snapshots;`);
    console.log("✓ Dropped market_snapshots");

    await pool.query(`DROP TABLE IF EXISTS marketable_items;`);
    console.log("✓ Dropped marketable_items");

    console.log("\nRecreating tables...");

    // Create market_snapshots table
    await pool.query(`
      CREATE TABLE market_snapshots (
        item_id integer NOT NULL,
        region text NOT NULL,
        data jsonb NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (item_id, region)
      );
    `);
    console.log("✓ Created market_snapshots");

    // Create marketable_items table
    await pool.query(`
      CREATE TABLE marketable_items (
        item_id integer PRIMARY KEY,
        last_scanned timestamptz,
        priority integer DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    console.log("✓ Created marketable_items");

    // Create job_history table
    await pool.query(`
      CREATE TABLE job_history (
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
    console.log("✓ Created job_history");

    console.log("\nCreating indexes...");

    await pool.query(`
      CREATE INDEX market_snapshots_fetched_at_idx
        ON market_snapshots (fetched_at);
    `);
    console.log("✓ Created index on market_snapshots (fetched_at)");

    await pool.query(`
      CREATE INDEX job_history_status_idx
        ON job_history (status, completed_at DESC);
    `);
    console.log("✓ Created index on job_history (status, completed_at)");

    await pool.query(`
      CREATE INDEX marketable_items_last_scanned_idx
        ON marketable_items (last_scanned NULLS FIRST);
    `);
    console.log("✓ Created index on marketable_items (last_scanned)");

    console.log("\nDatabase reset completed successfully.");
  } catch (err) {
    console.error("\nDatabase reset failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

resetDatabase();
