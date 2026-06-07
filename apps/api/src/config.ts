export const config = {
  port: Number(process.env.PORT ?? 4000),
  universalisBaseUrl: process.env.UNIVERSALIS_BASE_URL ?? "https://universalis.app/api/v2",
  xivapiBaseUrl: process.env.XIVAPI_BASE_URL ?? "https://v2.xivapi.com/api",
  universalisRequestsPerSecond: Number(process.env.UNIVERSALIS_REQS_PER_SECOND ?? 20),
  arbitrageItemLimit: Number(process.env.ARBITRAGE_ITEM_LIMIT ?? 80),
  arbitrageMaxConcurrency: Number(process.env.ARBITRAGE_MAX_CONCURRENCY ?? 4)
};
