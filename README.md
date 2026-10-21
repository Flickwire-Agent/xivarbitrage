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

## Worker regression checks

With Node.js 24, dependencies installed, and `redis-server` on PATH, run
`pnpm --filter @xiv-arbitrage/api test`. The processor tests use Node's experimental
module mocks to exercise the real worker processor and Universalis client. The
scheduler regression starts a disposable Redis instance on a private Unix socket
with TCP and persistence disabled to verify exhausted-job recovery with real BullMQ.
The suite requires no running PostgreSQL or Redis service and makes no external HTTP requests.
See [worker retries and counters](docs/worker-retries.md) for operational semantics.

## World mapping cache

`apps/api/data/world-dc-mapping.json` is the versioned, read-only fallback seed.
The service loads `apps/api/data/cache/world-dc-mapping.json` first, falling back
to the seed if the cache is missing, unreadable, or invalid JSON. Both paths are
relative to the API package in development and compiled execution, not the shell's
working directory. Offline startup therefore works without a runtime cache.

Semantic Universalis mapping changes are written atomically to the Git-ignored
`data/cache/` directory; unchanged mappings retain their existing timestamp.
The API user needs write access to that directory. Cache writes never update the
seed. Review upstream topology changes separately before updating the seed in Git.

For installations where older code already modified the tracked seed, preserve
that file and its diff outside the checkout before restoring the reviewed seed.
Do not commit generated topology changes just to clear a deployment check. Review
the saved mapping before optionally copying it into the new cache path. Perform
this migration with the old service stopped so it cannot rewrite the seed, then
deploy the reviewed, published commit using the established deployment helper.

## Operations

See [Interpreting ingestion status](docs/ingestion-status.md) for the meanings and
limits of `/api/health`, `/api/worker/status`, and `/api/freshness`, including
read-only checks for queue activity and market-data freshness.

## Notes

Universalis documentation currently lists an API rate limit of 25 requests per second with a 50 request burst. The API package uses a local token-bucket limiter and defaults below that ceiling.
