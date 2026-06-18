import pg from "pg";
import { config } from "../config.js";

export const pool = config.databaseUrl
  ? new pg.Pool({
      connectionString: config.databaseUrl,
      max: 20,
      ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
    })
  : null;

export default pool;
