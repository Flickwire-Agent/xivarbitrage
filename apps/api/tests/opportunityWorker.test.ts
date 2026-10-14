import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import type { EvaluateItemJob } from "../src/services/jobQueue.js";
import type { UniversalisMarketData } from "../src/services/universalis.js";

type TestJob = { id: string; data: EvaluateItemJob };
type Result = { processed: boolean; processedRegions: number; skippedFreshRegions: number };
let processJob: (job: TestJob) => Promise<Result>;
let queueOptions: {
  defaultJobOptions: { attempts: number; backoff: { type: string; delay: number } };
};
const handlers = new Map<string, (...args: any[]) => void>();

class FakeEvents {
  on(event: string, handler: (...args: any[]) => void) {
    handlers.set(event, handler);
  }
  async close() {}
}

mock.module("bullmq", {
  namedExports: {
    Worker: class extends FakeEvents {
      constructor(_name: string, processor: typeof processJob) {
        super();
        processJob = processor;
      }
    },
    Queue: class extends FakeEvents {
      constructor(_name: string, options: typeof queueOptions) {
        super();
        queueOptions = options;
      }
    },
    QueueEvents: FakeEvents,
  },
});
mock.module("../src/config.ts", {
  namedExports: {
    config: {
      databaseUrl: "mock-only",
      redisUrl: "mock-only",
      jobQueueConcurrency: 4,
      universalisBaseUrl: "https://universalis.invalid/api/v2",
    },
  },
});
mock.module("../src/services/rateLimiter.ts", {
  namedExports: { rateLimiter: { schedule: (fn: () => Promise<unknown>) => fn() } },
});

const queries: { sql: string; params: unknown[] }[] = [];
let failHistory = false;
mock.module("../src/db/pool.ts", {
  namedExports: {
    pool: {
      async query(sql: string, params: unknown[]) {
        if (failHistory && sql.includes("job_history")) throw new Error("history unavailable");
        queries.push({ sql, params });
        return { rows: [] };
      },
    },
  },
});

const snapshots = new Map<string, UniversalisMarketData>();
const writes: string[] = [];
let failSales = false;
mock.module("../src/services/marketSnapshotStore.ts", {
  namedExports: {
    marketSnapshotStore: {
      async getFresh(region: string) {
        return snapshots.get(region) ?? null;
      },
      async storeSales() {
        if (failSales) throw new Error("sales unavailable");
        writes.push("sales");
      },
      async upsert(region: string, _itemId: number, data: UniversalisMarketData) {
        writes.push(region);
        snapshots.set(region, data);
      },
    },
  },
});

let now = 0;
mock.method(Date, "now", () => now);
const logs = mock.method(console, "log", () => {});
const errors = mock.method(console, "error", () => {});
const fetchMock = mock.method(globalThis, "fetch");
const market = { itemID: 42, listings: [], recentHistory: [] };
const job: TestJob = { id: "scan-42", data: { itemId: 42, region: "Europe" } };
const { initializeWorker, closeWorker } = await import("../src/services/opportunityWorker.js");
const { getQueue, closeQueue } = await import("../src/services/jobQueue.js");
getQueue();
await initializeWorker();

beforeEach(() => {
  queries.length = 0;
  writes.length = 0;
  snapshots.clear();
  failHistory = false;
  failSales = false;
  logs.mock.resetCalls();
  errors.mock.resetCalls();
  fetchMock.mock.resetCalls();
  fetchMock.mock.mockImplementation(async () => Response.json(market));
  now += 60001;
});

after(async () => {
  await closeWorker();
  await closeQueue();
  mock.restoreAll();
});

function history() {
  return queries.filter(({ sql }) => sql.includes("job_history")).map(({ params }) => params);
}

function scanRegions() {
  return queries
    .filter(({ sql }) => sql.includes("item_region_scan_state"))
    .map(({ params }) => params[1]);
}

test("successful empty market data is ingestion, with sales persisted before the snapshot", async () => {
  const result = await processJob(job);
  assert.equal(result.processed, true);
  assert.equal(result.processedRegions, 1);
  assert.equal(result.skippedFreshRegions, 0);
  assert.deepEqual(writes, ["sales", "Europe"]);
  assert.deepEqual(scanRegions(), ["Europe"]);
  assert.deepEqual(history(), [["scan-42", 42, "Europe", "completed"]]);
});

test("fresh snapshot skips fetch and counts reuse separately from ingestion", async () => {
  snapshots.set("Europe", market);
  const result = await processJob(job);
  assert.equal(result.processedRegions, 0);
  assert.equal(result.skippedFreshRegions, 1);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(writes, []);
  assert.deepEqual(history(), [["scan-42", 42, "Europe", "skipped_fresh"]]);
});

test("HTTP 504 rejects every attempt under the queue's three-attempt exponential policy", async () => {
  fetchMock.mock.mockImplementation(async () => new Response("unavailable", { status: 504 }));
  assert.deepEqual(queueOptions.defaultJobOptions.backoff, { type: "exponential", delay: 2000 });
  assert.equal(queueOptions.defaultJobOptions.attempts, 3);
  for (let attempt = 0; attempt < queueOptions.defaultJobOptions.attempts; attempt++) {
    await assert.rejects(processJob(job), /Universalis request failed: 504/);
    now += 60001;
  }
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.deepEqual(writes, []);
  assert.deepEqual(scanRegions(), []);
  assert.equal(history().length, 3);
  assert.ok(history().every((row) => row[2] === "Europe" && row[3] === "failed"));
  assert.equal(logs.mock.callCount(), 3);
  assert.ok(
    logs.mock.calls.every(({ arguments: args }) =>
      /attempts=1 jobs=0 failed=1 regions=0/.test(args[0]),
    ),
  );
});

test("abort propagates unchanged without advancing scan state", async () => {
  const abort = new DOMException("Request aborted", "AbortError");
  fetchMock.mock.mockImplementation(async (_url, options) => {
    assert.ok(options?.signal instanceof AbortSignal);
    throw abort;
  });
  await assert.rejects(processJob(job), (error) => error === abort);
  assert.deepEqual(writes, []);
  assert.deepEqual(scanRegions(), []);
  assert.equal(history()[0][2], "Europe");
  assert.equal(history()[0][3], "failed");
});

test("the ten-second timeout aborts a pending fetch and rejects the processor", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | null | undefined;
  fetchMock.mock.mockImplementation(async (_url, options) => {
    signal = options?.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
    });
  });
  const rejected = assert.rejects(processJob(job), { name: "AbortError" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(signal);
  t.mock.timers.tick(9999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.deepEqual(writes, []);
  assert.deepEqual(scanRegions(), []);
});

for (const [name, body] of [
  ["null", "null"],
  ["wrong item", '{"itemID":43}'],
  ["invalid JSON", "{"],
] as const) {
  test(`${name} response rejects instead of creating an empty successful scan`, async () => {
    fetchMock.mock.mockImplementation(async () => new Response(body));
    await assert.rejects(processJob(job));
    assert.deepEqual(writes, []);
    assert.deepEqual(scanRegions(), []);
    assert.equal(history()[0][3], "failed");
  });
}

test("partial legacy job preserves successful history and retries only unfinished ingestion", async () => {
  const legacy: TestJob = { id: "legacy-42", data: { itemId: 42 } };
  fetchMock.mock.mockImplementation(async (url) =>
    String(url).includes("Europe")
      ? new Response("timeout", { status: 504 })
      : Response.json(market),
  );
  await assert.rejects(processJob(legacy), /504/);
  assert.deepEqual(scanRegions(), ["North-America"]);
  assert.deepEqual(
    history().map((row) => row.slice(2, 4)),
    [
      ["North-America", "completed"],
      ["Europe", "failed"],
    ],
  );
  assert.match(logs.mock.calls[0].arguments[0], /jobs=0 failed=1 regions=1/);

  fetchMock.mock.resetCalls();
  fetchMock.mock.mockImplementation(async () => Response.json(market));
  const result = await processJob(legacy);
  assert.equal(result.processedRegions, 2);
  assert.equal(result.skippedFreshRegions, 1);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.ok(
    fetchMock.mock.calls.every(({ arguments: args }) => !String(args[0]).includes("North-America")),
  );
  assert.deepEqual(
    history()
      .slice(2)
      .map((row) => row.slice(2, 4)),
    [
      ["North-America", "skipped_fresh"],
      ["Europe", "completed"],
      ["Oceania", "completed"],
    ],
  );
  // Flush the retry's metrics so subsequent tests each observe their own window.
  now += 60001;
  await processJob(job);
});

test("failed sales persistence cannot publish a fresh snapshot that would mask unfinished work", async () => {
  failSales = true;
  await assert.rejects(processJob(job), /sales unavailable/);
  assert.equal(snapshots.size, 0);
  assert.deepEqual(scanRegions(), []);
  failSales = false;
  const result = await processJob(job);
  assert.equal(result.processedRegions, 1);
  assert.equal(fetchMock.mock.callCount(), 2);
  now += 60001;
  await processJob(job);
});

test("failure-history outage does not replace the original fetch error", async () => {
  failHistory = true;
  fetchMock.mock.mockImplementation(async () => new Response("timeout", { status: 504 }));
  await assert.rejects(processJob(job), /504/);
  assert.ok(
    errors.mock.calls.some(({ arguments: args }) =>
      args[0].includes("Could not record failed attempt"),
    ),
  );
});

test("worker failure event describes an attempt without claiming retries are exhausted", () => {
  handlers.get("failed")?.(
    { id: "scan-42", attemptsMade: 1, opts: { attempts: 3 } },
    new Error("timeout"),
  );
  assert.match(errors.mock.calls[0].arguments[0], /attempt 1\/3 failed: timeout/);
});
