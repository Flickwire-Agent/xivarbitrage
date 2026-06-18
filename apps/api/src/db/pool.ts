import pg from "pg";
import { config } from "../config.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

export default pool;
export { pool };
