import { config } from "../config.js";
import pool from "../db/pool.js";
import { RateLimiter } from "./rateLimiter.js";

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

class TtlCache {
  private store = new Map<string, CacheEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly ttlMs: number) {
    this.cleanupInterval = setInterval(() => this.evictStale(), 60_000);
    this.cleanupInterval.unref();
  }

  get(key: string): unknown | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: unknown): void {
    this.store.set(key, { data, expiresAt: Date.now() + this.ttlMs });
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

const ITEM_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL = 60 * 60 * 1000;
const RATE_LIMIT_RPS = 20;

class XivapiProxy {
  private readonly rateLimiter: RateLimiter;
  private readonly itemCache: TtlCache;
  private readonly searchCache: TtlCache;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.rateLimiter = new RateLimiter(RATE_LIMIT_RPS);
    this.itemCache = new TtlCache(ITEM_CACHE_TTL);
    this.searchCache = new TtlCache(SEARCH_CACHE_TTL);
    this.cleanupInterval = setInterval(() => this.pruneExpired(), 3_600_000);
    this.cleanupInterval.unref();
  }

  async fetchSheetItem(itemId: number, fields: string): Promise<unknown> {
    const cacheKey = `item:${itemId}:${fields}`;

    const l1Hit = this.itemCache.get(cacheKey);
    if (l1Hit) return l1Hit;

    const l2Hit = await this.queryDb(cacheKey);
    if (l2Hit !== null) {
      this.itemCache.set(cacheKey, l2Hit);
      return l2Hit;
    }

    return this.rateLimiter.schedule(async () => {
      const recheck = this.itemCache.get(cacheKey);
      if (recheck) return recheck;

      const url = new URL(`${config.xivapiBaseUrl}/sheet/Item/${itemId}`);
      url.searchParams.set("fields", fields);
      const headers: Record<string, string> = {};
      if (config.xivapiApiKey) headers["X-API-Key"] = config.xivapiApiKey;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`XIVAPI request failed: ${response.status}`);
      }
      const data: unknown = await response.json();
      this.itemCache.set(cacheKey, data);
      this.storeDb(cacheKey, data, "item").catch(() => {});
      return data;
    });
  }

  async fetchSearch(params: URLSearchParams): Promise<unknown> {
    const cacheKey = `search:${params.toString()}`;

    const cached = this.searchCache.get(cacheKey);
    if (cached) return cached;

    return this.rateLimiter.schedule(async () => {
      const url = new URL(`${config.xivapiBaseUrl}/search`);
      url.search = params.toString();
      const headers: Record<string, string> = {};
      if (config.xivapiApiKey) headers["X-API-Key"] = config.xivapiApiKey;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`XIVAPI search failed: ${response.status}`);
      }
      const data: unknown = await response.json();
      this.searchCache.set(cacheKey, data);
      return data;
    });
  }

  private async queryDb(cacheKey: string): Promise<unknown | null> {
    try {
      const result = await pool.query(
        `SELECT data FROM xivapi_cache WHERE cache_key = $1 AND expires_at > NOW()`,
        [cacheKey],
      );
      return result.rows[0]?.data ?? null;
    } catch {
      return null;
    }
  }

  private async storeDb(cacheKey: string, data: unknown, category: string): Promise<void> {
    const expiresAt = new Date(Date.now() + ITEM_CACHE_TTL).toISOString();
    await pool.query(
      `INSERT INTO xivapi_cache (cache_key, data, category, expires_at)
       VALUES ($1, $2::jsonb, $3, $4::timestamptz)
       ON CONFLICT (cache_key) DO UPDATE
         SET data = $2::jsonb, expires_at = $4::timestamptz`,
      [cacheKey, JSON.stringify(data), category, expiresAt],
    );
  }

  private async pruneExpired(): Promise<void> {
    try {
      await pool.query(`DELETE FROM xivapi_cache WHERE expires_at <= NOW()`);
    } catch {
      // cleanup failures are non-critical
    }
  }
}

export const xivapiProxy = new XivapiProxy();
