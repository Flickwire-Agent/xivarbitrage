# Interpreting ingestion status

Dependency health, queue activity, scan coverage, and market-data freshness answer
different questions. Read these endpoints together before concluding that ingestion
is healthy. In particular, `progress: "100.00%"` and a recent `lastFullScan` do not
establish that every item-region snapshot is fresh.

## Read-only checks

```sh
base=https://xivarbitrage.projects.blueskye.co.uk
curl --fail --silent --show-error --connect-timeout 5 --max-time 20 "$base/api/health"
curl --fail --silent --show-error --connect-timeout 5 --max-time 20 "$base/api/worker/status"
curl --fail --silent --show-error --connect-timeout 5 --max-time 20 "$base/api/freshness"
```

Record observation times in UTC. These requests are separate observations, not an
atomic snapshot. Inspect response bodies as well as HTTP status: `/worker/status`
can return an `error` object with HTTP 200, and `/freshness` exposes degraded states
in its body rather than using them to set an unhealthy HTTP status.

## Dependency health

`GET /api/health` checks PostgreSQL and Redis connectivity. Both passing returns
`{ "ok": true, "database": true, "redis": true }`; a failed check returns HTTP 503.
This does not test Universalis, worker progress, or the age of stored market data.

## Worker status

`GET /api/worker/status` combines BullMQ counts and database aggregates:

| Field                                              | Meaning                                                                                                                        | Interpretation limit                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queue.pending`                                    | Waiting plus prioritized jobs.                                                                                                 | Excludes active, delayed, and paused jobs. `prioritized` is already included; do not add it twice.                                                   |
| `queue.active`, `delayed`, `prioritized`, `paused` | Jobs currently in those BullMQ states.                                                                                         | One observation cannot establish whether the queue is draining.                                                                                      |
| `queue.completed`, `failed`                        | Completed or failed jobs still retained in BullMQ.                                                                             | Not lifetime or 24-hour totals. Both have a 300-second age-based removal policy; cleanup is not an exact rolling-window counter.                     |
| `items.total`, `scanned`, `progress`               | Marketable items; items whose existing regional scan-state rows all have a non-null `last_scanned`; percentage of total items. | Coverage since a recorded scan, with no age cutoff. The query does not independently validate that every configured region has a row.                |
| `itemRegions.total`, `scanned`, `progress`         | Scan-state rows; rows with non-null `last_scanned`; percentage scanned.                                                        | Coverage, not current freshness. A fresh-cache skip also records a scan.                                                                             |
| `itemRegions.due`                                  | Scan-state rows with `next_scan_at <= now()`.                                                                                  | Scheduling backlog, not a count of failed requests or necessarily the current queue depth.                                                           |
| `jobs24h`                                          | `job_history` row counts grouped by status, using `created_at` within the last 24 hours.                                       | Counts history rows, not distinct queue jobs or all upstream attempts. Absent statuses are omitted. Legacy multi-region jobs can write several rows. |
| `lastFullScan`                                     | `MAX(last_scanned)` across regional scan state.                                                                                | The latest individual recorded scan, **not** the completion time of a full scan.                                                                     |

The scheduler normally creates one job per item-region pair. A successful ingestion
or fresh-cache skip schedules that pair's next scan 24 hours later. Due pairs can
remain outside the queue while existing active, delayed, prioritized, or waiting
jobs drain. The scheduler's cooldown also affects when it next queues due work.

### Failures, retries, and recovery

Since [PR #101](https://github.com/Flickwire-Agent/xivarbitrage/pull/101), upstream
HTTP, transport, abort, parse, and invalid-item failures reject the processor. The
worker attempts to record failed history for the actual region, then rethrows even
if history persistence fails. A failed fetch writes no snapshot or successful scan
state. Valid responses with empty listings and sales still count as ingestion.

The queue configures **three total attempts**, with exponential backoff starting at
two seconds. Backoff is not a retry-completion deadline: queued work and worker
capacity can delay the next attempt. A fixed interval containing only `attempt 1/3`
messages does not by itself prove retries are broken.

Keep these failure counts separate:

- `queue.failed` counts retained terminal failures, not attempts awaiting retry.
- `jobs24h.failed` counts persisted failed region-history rows; retries can add
  rows for the same job and region, and database failures can prevent recording.
- Worker metric `failed` counts rejected processor invocations, including retryable
  attempts. Metrics are emitted on attempt completion after at least 60 seconds,
  not by an idle heartbeat. Their windows need not match timestamp-filtered history.

After retries are exhausted, failed pairs remain due. Once outstanding jobs drain,
an eligible scheduler pass removes up to 1,000 terminal failed jobs older than five
minutes to release their deterministic IDs before enqueueing due pairs. Recovery
also depends on cooldown and available dependencies; five minutes is a minimum
retention period, not a recovery deadline. A cleanup log proves IDs were released,
not that those pairs subsequently ingested successfully.

See [worker retries and counters](worker-retries.md) for persistence ordering,
legacy multi-region jobs, and the full metric definitions. Baselines from before
the repair may hide fetch failures; increased visible failures alone do not prove
upstream availability worsened. Honest failure accounting also does not establish
freshness recovery: compare successful regional throughput and snapshot ages over
dated intervals.

## Freshness

`GET /api/freshness` reports dependency booleans, a subset of queue counts, timestamps,
and derived `healthy`, `warning`, or `stale` states.

| Timestamp                                                | Meaning                                                                                  | Warning threshold                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `marketData.oldestSnapshotAt`                            | Oldest timestamp among the latest stored snapshot for each represented item-region pair. | `MARKET_SNAPSHOT_FRESH_HOURS` (default 6 hours), used for `freshness.snapshots`.                      |
| `marketData.newestSnapshotAt`                            | Newest of those snapshots.                                                               | No separate derived state. Useful evidence of recent retrieval, not full coverage.                    |
| `marketData.lastWorkerActivityAt`                        | Maximum `job_history.completed_at`.                                                      | 24 hours, used for `freshness.worker`. A recent history row does not prove all pairs are progressing. |
| `caches.bargainsGeneratedAt`, `dcDisparitiesGeneratedAt` | Each in-memory cache's generation timestamp.                                             | `ARBITRAGE_REFRESH_MINUTES` (default 15 minutes), used for the corresponding cache state.             |

A valid timestamp is `healthy` up to and including its threshold, `warning` above
the threshold through twice the threshold, and `stale` above twice the threshold.
Missing or invalid timestamps are `stale`. With defaults, snapshots become warning
after 6 hours and stale after 12 hours; cache states do so after 15 and 30 minutes.

Important limits:

- Snapshot timestamps measure local retrieval, not the age of player-uploaded data
  inside the Universalis response.
- The snapshot query covers pairs present in storage. It does not count configured
  pairs that have no snapshot, or report how many pairs exceed an age threshold.
- The 6-hour default freshness threshold is shorter than the 24-hour scan interval.
  A stale snapshot aggregate alone does not establish a newly stalled worker.
- A healthy derived cache can have been regenerated from old snapshots. Its
  generation time is not a market-data freshness guarantee.
- The freshness route substitutes zero queue counts if queue-stat retrieval throws.
  Read dependency booleans and `/worker/status` errors before treating zeros as an
  empty queue.

## A bounded diagnostic sequence

1. Check dependency health and response errors first.
2. Compare dated observations of queue states, due pairs, newest snapshot time, and
   worker activity. Keep scan coverage separate from freshness.
3. Inspect a fixed UTC journal interval for `Universalis.getCurrentData`, `[Worker]`, and
   `[JobScheduler]` messages. Worker metric windows and fetch warnings do not share
   an exact denominator; do not derive an upstream success rate by dividing them.
4. If backlog impact matters, measure snapshot age distributions and missing-pair
   coverage with bounded, read-only database queries. The oldest timestamp alone
   cannot quantify the affected population.

## Source references

- [Endpoint queries and freshness classification](../apps/api/src/routes/api.ts)
- [Queue counters, retention, and retry settings](../apps/api/src/services/jobQueue.ts)
- [Worker persistence and success/failure accounting](../apps/api/src/services/opportunityWorker.ts)
- [Due-pair scheduling and outstanding-job gate](../apps/api/src/services/jobScheduler.ts)
- [Upstream fetch behavior](../apps/api/src/services/universalis.ts)
