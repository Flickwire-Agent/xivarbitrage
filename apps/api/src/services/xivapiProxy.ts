import type { ItemDetails } from "@xiv-arbitrage/shared";
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

  set(key: string, data: unknown, ttlMs?: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + (ttlMs ?? this.ttlMs) });
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
const NEGATIVE_CACHE_404_TTL = 60 * 60 * 1000;
const NEGATIVE_CACHE_ERROR_TTL = 5 * 60 * 1000;
const RATE_LIMIT_RPS = 20;
const ITEM_DETAIL_FIELDS = "Name,Icon,ItemUICategory.Name";

interface XivApiItemResponse {
  row_id?: number;
  fields?: {
    Name?: string;
    Icon?: { path?: string; path_hr1?: string };
    ItemUICategory?: { fields?: { Name?: string } };
  };
}

function buildIconUrl(iconPath: string | undefined): string | undefined {
  if (!iconPath) return undefined;
  return `${config.xivapiBaseUrl}/asset?path=${encodeURIComponent(iconPath)}&format=png`;
}

function parseItemDetails(itemId: number, data: unknown): ItemDetails | undefined {
  if (!data || typeof data !== "object") return undefined;
  const item = data as XivApiItemResponse;
  const name = item.fields?.Name;
  if (!name) return undefined;
  const iconPath = item.fields?.Icon?.path ?? item.fields?.Icon?.path_hr1;
  return {
    id: item.row_id ?? itemId,
    name,
    iconUrl: buildIconUrl(iconPath),
    category: item.fields?.ItemUICategory?.fields?.Name,
  };
}

class XivapiProxy {
  private readonly rateLimiter: RateLimiter;
  private readonly itemCache: TtlCache;
  private readonly searchCache: TtlCache;
  private readonly negativeCache = new TtlCache(NEGATIVE_CACHE_ERROR_TTL);
  private readonly inFlightItemRequests = new Map<string, Promise<unknown>>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.rateLimiter = new RateLimiter(RATE_LIMIT_RPS);
    this.itemCache = new TtlCache(ITEM_CACHE_TTL);
    this.searchCache = new TtlCache(SEARCH_CACHE_TTL);
    this.cleanupInterval = setInterval(() => this.pruneExpired(), 3_600_000);
    this.cleanupInterval.unref();
  }

  async fetchSheetItem(itemId: number, fields: string): Promise<unknown> {
    const cacheKey = this.itemCacheKey(itemId, fields);

    const l1Hit = this.itemCache.get(cacheKey);
    if (l1Hit) return l1Hit;

    if (this.negativeCache.get(cacheKey)) return null;

    const l2Hit = await this.queryDb(cacheKey);
    if (l2Hit !== null) {
      this.itemCache.set(cacheKey, l2Hit);
      return l2Hit;
    }

    const inFlight = this.inFlightItemRequests.get(cacheKey);
    if (inFlight) return inFlight;

    const request = this.rateLimiter.schedule(async () => {
      const recheck = this.itemCache.get(cacheKey);
      if (recheck) return recheck;
      if (this.negativeCache.get(cacheKey)) return null;

      const url = new URL(`${config.xivapiBaseUrl}/sheet/Item/${itemId}`);
      url.searchParams.set("fields", fields);
      const headers: Record<string, string> = {};
      if (config.xivapiApiKey) headers["X-API-Key"] = config.xivapiApiKey;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        const ttl = response.status === 404 ? NEGATIVE_CACHE_404_TTL : NEGATIVE_CACHE_ERROR_TTL;
        this.negativeCache.set(cacheKey, { status: response.status }, ttl);
        throw new Error(`XIVAPI request failed: ${response.status}`);
      }
      const data: unknown = await response.json();
      this.itemCache.set(cacheKey, data);
      this.storeDb(cacheKey, data, "item").catch(() => {});
      return data;
    });
    this.inFlightItemRequests.set(cacheKey, request);

    try {
      return await request;
    } finally {
      this.inFlightItemRequests.delete(cacheKey);
    }
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

  async getCachedItemDetails(itemIds: number[]): Promise<Record<number, ItemDetails>> {
    const uniqueIds = [...new Set(itemIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (uniqueIds.length === 0) return {};

    const details: Record<number, ItemDetails> = {};
    const missing: number[] = [];

    for (const itemId of uniqueIds) {
      const cacheKey = this.itemCacheKey(itemId, ITEM_DETAIL_FIELDS);
      const cached = this.itemCache.get(cacheKey);
      const parsed = parseItemDetails(itemId, cached);
      if (parsed) {
        details[itemId] = parsed;
      } else if (!this.negativeCache.get(cacheKey)) {
        missing.push(itemId);
      }
    }

    if (missing.length === 0) return details;

    try {
      const keys = missing.map((itemId) => this.itemCacheKey(itemId, ITEM_DETAIL_FIELDS));
      const result = await pool.query<{ cache_key: string; data: unknown }>(
        `SELECT cache_key, data FROM xivapi_cache WHERE cache_key = ANY($1) AND expires_at > NOW()`,
        [keys],
      );
      const itemIdByCacheKey = new Map(keys.map((key, i) => [key, missing[i]!]));
      for (const row of result.rows) {
        const itemId = itemIdByCacheKey.get(row.cache_key);
        if (!itemId) continue;
        const parsed = parseItemDetails(itemId, row.data);
        if (!parsed) continue;
        details[itemId] = parsed;
        this.itemCache.set(row.cache_key, row.data);
      }
    } catch {
      // Metadata enrichment must never block market data responses.
    }

    return details;
  }

  async fetchItemDetailsBatch(
    itemIds: number[],
    waitMs: number,
  ): Promise<{ itemDetails: Record<number, ItemDetails>; pendingItemIds: number[] }> {
    const uniqueIds = [...new Set(itemIds)].filter((id) => Number.isInteger(id) && id > 0);
    const itemDetails = await this.getCachedItemDetails(uniqueIds);
    const missingIds = uniqueIds.filter((itemId) => !itemDetails[itemId]);

    if (missingIds.length === 0) {
      return { itemDetails, pendingItemIds: [] };
    }

    const fetches = missingIds.map(async (itemId) => {
      try {
        const raw = await this.fetchSheetItem(itemId, ITEM_DETAIL_FIELDS);
        const parsed = parseItemDetails(itemId, raw);
        if (parsed) itemDetails[itemId] = parsed;
      } catch {
        // Individual metadata failures should not fail the whole batch.
      }
    });

    await Promise.race([
      Promise.allSettled(fetches),
      new Promise((resolve) => setTimeout(resolve, waitMs)),
    ]);

    return {
      itemDetails,
      pendingItemIds: missingIds.filter((itemId) => !itemDetails[itemId]),
    };
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

  private itemCacheKey(itemId: number, fields: string): string {
    return `item:${itemId}:${fields}`;
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
