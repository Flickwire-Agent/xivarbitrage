export const config = {
  port: Number(process.env.PORT ?? 4000),
  universalisBaseUrl: process.env.UNIVERSALIS_BASE_URL ?? "https://universalis.app/api/v2",
  xivapiBaseUrl: process.env.XIVAPI_BASE_URL ?? "https://v2.xivapi.com/api",
  universalisRequestsPerSecond: Number(process.env.UNIVERSALIS_REQS_PER_SECOND ?? 20),
  arbitrageItemLimit: Number(process.env.ARBITRAGE_ITEM_LIMIT ?? 250),
  arbitrageMaxConcurrency: Number(process.env.ARBITRAGE_MAX_CONCURRENCY ?? 4),
  arbitrageRefreshMinutes: Number(process.env.ARBITRAGE_REFRESH_MINUTES ?? 15),
  marketSnapshotFreshHours: Number(process.env.MARKET_SNAPSHOT_FRESH_HOURS ?? 6),
  marketSnapshotRetentionDays: Number(process.env.MARKET_SNAPSHOT_RETENTION_DAYS ?? 14),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jobQueueConcurrency: Number(process.env.JOB_QUEUE_CONCURRENCY ?? 4)
};
