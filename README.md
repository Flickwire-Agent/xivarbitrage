# XIV Arbitrage

A pnpm workspace monorepo for finding Final Fantasy XIV item arbitrage opportunities across worlds and data centers.

## Packages

- `apps/api`: Node.js TypeScript API using Fastify. It reads market data from Universalis within the documented API rate limit and enriches item details through XIVAPI v2.
- `apps/web`: React SPA built with Vite. It displays and filters arbitrage opportunities without SSR.
- `packages/shared`: Shared TypeScript types used by both apps.

## Getting Started

```powershell
pnpm install
pnpm dev
```

The API defaults to `http://localhost:4000` and the SPA defaults to `http://localhost:5173`.

## API Configuration

Optional environment variables:

- `PORT`: API port. Defaults to `4000`.
- `UNIVERSALIS_BASE_URL`: Defaults to `https://universalis.app/api/v2`.
- `XIVAPI_BASE_URL`: Defaults to `https://v2.xivapi.com/api`.
- `UNIVERSALIS_REQS_PER_SECOND`: Defaults to `20`, below the documented `25 req/s` API limit.
- `ARBITRAGE_REFRESH_MINUTES`: DC disparity and bargain cache refresh interval. Defaults to `15`.
- `MARKET_SNAPSHOT_FRESH_HOURS`: Current listing snapshot freshness window. Defaults to `6`.
- `MARKET_WARNING_LOW_SALE_COUNT`: Recent-sale threshold for low-liquidity warnings. Defaults to `7`.
- `MARKET_WARNING_MIN_DATA_CENTERS`: Minimum DC coverage before limited-coverage warnings appear. Defaults to `2`.
- `MARKET_WARNING_STALE_AVERAGE_HOURS`: DC average age threshold for stale-average warnings. Defaults to `6`.
- `VITE_PLAUSIBLE_DOMAIN`: Domain for Plausible analytics (EU-based, privacy-friendly). Set to your domain to enable analytics. Omit to disable. Must be set during web build.

## Notes

Universalis documentation currently lists an API rate limit of 25 requests per second with a 50 request burst. The API package uses a local token-bucket limiter and defaults below that ceiling.
