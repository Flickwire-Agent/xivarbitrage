# Performance Optimization TODOs

Ranked by impact. Each item includes the problem, remediation approach, and expected impact.

---

## Critical

### 1. [DONE] Consolidate to a single shared `pg.Pool` singleton

**Problem:** 11 separate `new Pool()` instances across every service file, each defaulting to `max: 10` connections. The app can open up to 110 PostgreSQL connections simultaneously, exhausting connection limits on Railway/hobby-tier Postgres (typically 10-25 connections).

**Remediation:**

- Create `apps/api/src/db/pool.ts` exporting a single configured pool (`max: 20`)
- Replace every `new Pool(...)` in services, routes, and workers with the shared import
- Files affected: `migrations.ts`, `arbitrage.ts`, `jobScheduler.ts`, `opportunityWorker.ts`, `marketSnapshotStore.ts`, `bargainsCache.ts`, `dcDisparityCache.ts`, `dcAverageStore.ts`, `routes/opportunities.ts`

**Impact:** Eliminates connection exhaustion. Reduces idle connection overhead from ~110 to ~20. Prevents `too many clients` errors under load.

---

### 2. [DONE] Fix N+1 query in `ArbitrageService.scanOpportunitiesFromDb()`

**Problem:** `arbitrage.ts:51-104` fetches up to 10,000 item IDs, then fires a separate `SELECT` per item to load snapshots. That's ~10,000 sequential database round-trips every 15-minute cache refresh.

**Remediation:**

- Replace the per-item loop with a batched query: `SELECT item_id, data, region FROM market_snapshots WHERE item_id = ANY($1::int[]) AND fetched_at > now() - interval '24 hours'`
- Process in batches of 500-1000 item IDs to manage memory
- Group results by `item_id` in memory

**Impact:** Reduces ~10,000 queries to ~10-20 batched queries per refresh cycle. Expected 10-50x speedup in cache refresh time.

---

### 3. [DONE] Eliminate pool create/destroy per HTTP request

**Problem:** `routes/opportunities.ts` creates a new `pg.Pool`, runs a single query, then calls `pool.end()` on every call to `/health`, `/items/:id/history`, and `/worker/status`. Pool creation involves DNS, TCP handshake, TLS, and Postgres auth (100-500ms overhead per request).

**Remediation:**

- Import the shared pool singleton from `db/pool.ts`
- Remove all `new Pool()`, `pool.end()` calls from route handlers

**Impact:** Health checks and status requests go from ~200-500ms to ~5-10ms. Eliminates connection churn on the Postgres server.

---

### 4. [DONE] Fix `last_scanned` never being updated

**Problem:** `marketable_items.last_scanned` is indexed and used for scheduling (`ORDER BY last_scanned NULLS FIRST`) and status reporting, but no code ever writes to it. Scheduling order is effectively random, and the worker status endpoint always reports 0% scanned.

**Remediation:**

- In `opportunityWorker.ts`, after a successful market data upsert, run: `UPDATE marketable_items SET last_scanned = now() WHERE item_id = $1`
- Or batch-update after job completion

**Impact:** Scheduling becomes deterministic (least-recently-scanned items prioritized). Worker status endpoint reports accurate progress.

---

### 5. [DONE] Fix N+1 query in `?includeHistory=true` route handler

**Problem:** `routes/opportunities.ts:115-137` iterates over each opportunity (up to 50) and fires an individual `SELECT` query for price history per item.

**Remediation:**

- Collect all item IDs from the opportunities list
- Run a single batched query: `SELECT item_id, fetched_at, (data->>'averagePrice')::numeric FROM market_snapshots WHERE item_id = ANY($1::int[]) AND fetched_at > now() - interval '7 days' ORDER BY fetched_at DESC`
- Distribute results back to each opportunity in memory

**Impact:** Reduces 50 sequential queries to 1 batched query per API request. Cuts latency by several seconds on history-enabled requests.

---

## High

### 6. [DONE] Add primary key to `sale_history`

**Problem:** `sale_history.id` is `bigserial` but has no `PRIMARY KEY` constraint. The table lacks a clustered index, making sequential scans slower and preventing efficient cursor-based pagination.

**Remediation:**

- Add migration: `ALTER TABLE sale_history ADD PRIMARY KEY (id)`

**Impact:** Creates an index on `id`, improves scan performance, enables efficient pagination patterns.

---

### 7. [DONE] Add retention policy for `job_history`

**Problem:** Every job (~30,000 per cycle) inserts a row. No cleanup exists. Table grows unbounded, degrading the worker status query and consuming disk.

**Remediation:**

- Add periodic cleanup in `jobScheduler.ts` or `server.ts`: `DELETE FROM job_history WHERE created_at < now() - interval '7 days'`
- Add index on `created_at` to support the cleanup query

**Impact:** Prevents unbounded table growth. Keeps the worker status query fast. Reclaims disk space.

---

### 8. [DONE] Add missing index on `sale_history.sold_at`

**Problem:** The hourly prune (`DELETE FROM sale_history WHERE sold_at < now() - 30 days`) cannot use the composite index `(item_id, sold_at)` since it doesn't filter on `item_id`. Results in a full sequential scan.

**Remediation:**

- Add migration: `CREATE INDEX ON sale_history (sold_at)`

**Impact:** Prune query goes from sequential scan to index scan. Could reduce cleanup time from seconds to milliseconds on large tables.

---

### 9. [DONE] Add missing index on `job_history.created_at`

**Problem:** The worker status query (`WHERE created_at > now() - 24h GROUP BY status`) has no usable index. The existing index is on `(status, completed_at DESC)`.

**Remediation:**

- Replace existing index with: `CREATE INDEX ON job_history (created_at, status)` to cover both the WHERE filter and GROUP BY

**Impact:** Worker status endpoint becomes an index scan instead of a full table scan.

---

### 10. [DONE] Remove double rate limiting

**Problem:** `UniversalisClient` has its own `RateLimiter` (`universalis.ts:39`), and `opportunityWorker.ts:32` wraps every call in the singleton `rateLimiter`. Each API call passes through two limiters, potentially halving throughput.

**Remediation:**

- Remove the internal `RateLimiter` from `UniversalisClient`
- Keep only the worker-level limiter which coordinates across concurrent workers

**Impact:** Up to 2x throughput improvement on Universalis API calls during scan cycles.

---

### 11. [DONE] Fix `dc_item_averages` DELETE-then-INSERT race condition

**Problem:** `dcAverageStore.ts:127` wipes the entire table with `DELETE FROM dc_item_averages`, then re-inserts in batches. Concurrent reads during this window return empty results.

**Remediation:**

- Remove the `DELETE` statement
- Use upsert-only (`ON CONFLICT DO UPDATE`) which is already in place
- After upserts, delete only stale rows: `DELETE FROM dc_item_averages WHERE computed_at < $1` (where `$1` is the start time of the current recompute)

**Impact:** Eliminates the race condition. Concurrent reads always get valid (possibly slightly stale) data instead of empty results.

---

### 12. [DONE] Use `queue.addBulk()` instead of sequential `queue.add()`

**Problem:** `jobScheduler.ts:231-238` adds 30,000 jobs one at a time with `await queue.add()`. Each call is a separate Redis round-trip (~1ms each = ~30 seconds total).

**Remediation:**

- Build an array of job descriptors and use `queue.addBulk(jobs)` in batches of 1000
- BullMQ's `addBulk` pipelines multiple jobs in a single Redis command

**Impact:** Queue population goes from ~30 seconds to ~1-2 seconds. Scan cycles start much sooner.

---

## Medium

### 13. Deduplicate BargainsCache and DcAverageStore work

**Problem:** `bargainsCache.ts` and `dcAverageStore.ts` independently query `sale_history`, compute IQR averages per data center, and fetch item details from XIVAPI. The same work is done twice.

**Remediation:**

- Refactor `BargainsCache.scan()` to consume pre-computed averages from `DcAverageStore` instead of recomputing
- Remove duplicate sale_history queries and IQR logic from `bargainsCache.ts`

**Impact:** Halves the database queries and XIVAPI calls during each refresh cycle. Reduces CPU usage for IQR computation.

---

### 14. [DONE] Add LRU eviction to unbounded in-memory caches

**Problem:** `xivapi.ts:26` (`Map<number, ItemDetails>`) and `routes/opportunities.ts:149` (`Map<string, results>`) grow indefinitely with no eviction policy.

**Remediation:**

- Replace `Map` with `lru-cache` (add `lru-cache` package) or implement a simple TTL-based eviction
- Set max size to ~15,000 for item cache, ~500 for search cache

**Impact:** Prevents gradual memory growth over the process lifetime. Reduces risk of OOM on long-running processes.

---

### 15. Cap `Promise.all` concurrency in `arbitrage.ts`

**Problem:** `arbitrage.ts:69-75` fires up to 10,000 concurrent promises via `Promise.all(itemsToEvaluate.map(...))`, creating massive memory pressure and potential pool exhaustion.

**Remediation:**

- Process items in chunks of 100 using a loop, or use `p-limit` to cap concurrency
- Example: `for (const chunk of chunks(items, 100)) { await Promise.all(chunk.map(...)) }`

**Impact:** Reduces peak memory usage during arbitrage scan. Prevents connection pool saturation.

---

### 16. [DONE] Remove duplicate migration logic from `marketSnapshotStore.init()`

**Problem:** `marketSnapshotStore.ts:39-77` re-runs CREATE TABLE/INDEX statements already handled by `migrations.ts`. Runs on every first query after process start.

**Remediation:**

- Remove the `init()` method and the lazy-init pattern
- Rely solely on `runMigrations()` called in `server.ts`

**Impact:** Eliminates redundant DDL on startup. Reduces startup latency and lock contention.

---

### 17. [DONE] Fix Redis health check connection overhead

**Problem:** `routes/opportunities.ts:59-70` dynamically imports `redis`, creates a new client, connects, pings, and disconnects on every `/health` request.

**Remediation:**

- Maintain a persistent Redis client instance for health checks
- Or reuse the existing BullMQ Redis connection to check connectivity

**Impact:** Health check goes from ~100-200ms (connection setup) to ~1-2ms (ping only).
