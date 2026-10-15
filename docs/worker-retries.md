# Worker retries and counters

The ingestion worker rejects HTTP, transport, abort, JSON parse, and invalid-item
response failures. Its only `UniversalisClient.getCurrentData` call site is the
worker; the client now throws instead of returning null. A valid response with
empty listings and sales is still successful ingestion.

BullMQ applies the existing queue defaults: **three total attempts**, with
exponential backoff starting at two seconds. Concurrency, the ten-second fetch
timeout, and rate limiting are unchanged. A failed fetch writes no snapshot or
successful scan state. Failed pairs remain due after bounded retries are exhausted.
On an eligible scheduling pass, once outstanding jobs drain, the scheduler removes
up to 1,000 terminal failed jobs older than five minutes before enqueueing due
pairs. This explicitly frees deterministic IDs: BullMQ's age retention is lazy
and alone does not guarantee recovery. Recent failures retain their grace period;
active, waiting, prioritized, and delayed retries prevent scheduling. Recovery
also depends on scheduler cooldown, queue drainage, and available database/Redis;
five minutes is a minimum retention period, not a recovery deadline. Larger failed
cohorts drain over multiple eligible passes. PostgreSQL history remains available.

Each attempted region writes its own `job_history` row. Failures name the actual
region, not `all`. A legacy job spanning multiple regions stops at the first
failure; successful earlier regions retain their history and snapshots. Retrying
reuses fresh snapshots and proceeds to unfinished regions. Sales are persisted
before the snapshot so a failed sales write cannot create a fresh-cache hit that
hides unfinished ingestion. Existing sales conflict handling makes repeated writes
safe. These writes are not a single transaction: if recording scan state or history
fails after snapshot persistence, a retry may record the region as `skipped_fresh`.
If failure-history persistence itself fails, the worker logs that separately and
still rejects with the original error.

## Reading the minute-window log

`[Worker] Metrics` is emitted on an attempt finishing after at least 60 seconds
since the previous emission, including when every attempt fails. It is not a timer
heartbeat and is not emitted during idle periods.

| Field                        | Meaning                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `attempts`                   | Completed processor invocations, successful or rejected                                                                           |
| `jobs`                       | Successfully resolved invocations, including fresh-cache-only jobs                                                                |
| `failed`                     | Rejected invocations, including retryable attempts, not just exhausted jobs                                                       |
| `regions`                    | Regions whose new market data and successful scan state were persisted, including those in a later-failed multi-region invocation |
| `skippedFresh`               | Regions whose existing fresh snapshot was reused and scan state recorded                                                          |
| `avgDuration`, `maxDuration` | Duration over all invocations in the window                                                                                       |

The worker's failed-event message reports `attempt N/M`; it does not claim every
failure has exhausted retries. The public queue's retained `failed` count describes
terminal failed jobs, while `jobs24h.failed` counts failed region-history rows.
They are not interchangeable denominators. A retry can add another history row
for the same job and region.

The status API's `items.progress` is still lifetime scan coverage, and
`lastFullScan` is still the maximum recorded scan timestamp, not proof of a complete
fresh scan. Use snapshot ages and `/api/freshness` for freshness assessment.

## Verification and rollout

Run `pnpm --filter @xiv-arbitrage/api test`. HTTP and persistence are mocked; processor tests
exercise the actual processor and client, including partial-region retries, while
checking the actual queue configuration through a mocked BullMQ constructor.
The scheduler regression requires `redis-server` on PATH and starts a disposable
instance with TCP and persistence disabled, using a private Unix socket. It runs
real BullMQ retries and scheduler enqueueing, verifies recovery without another
terminal failure, and checks recent-failure retention and delayed-retry protection.
It ages only the test job's Redis timestamps instead of waiting five minutes;
PostgreSQL due-row selection is mocked. Tests do not contact live upstream services.

After review and deployment, compare a fixed journal interval and overdue snapshot
counts with the baseline in [issue #98](https://github.com/Flickwire-Agent/xivarbitrage/issues/98).
An increased reported failure count is expected when previously hidden failures
become visible; it alone does not imply that upstream availability worsened.
