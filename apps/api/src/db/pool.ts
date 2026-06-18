import pg from "pg";
import { config } from "../config.js";

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
});

export default pool;
