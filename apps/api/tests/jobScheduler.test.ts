import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue, Worker } from "bullmq";

async function until(check: () => boolean | Promise<boolean>, description: string) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`);
    await sleep(20);
  }
}

test(
  "scheduler recovers aged exhausted IDs without another failure",
  { timeout: 30_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "scan-recovery-"));
    const socket = join(dir, "redis.sock");
    const redis = spawn(
      "redis-server",
      [
        "--port",
        "0",
        "--unixsocket",
        socket,
        "--unixsocketperm",
        "700",
        "--save",
        "",
        "--appendonly",
        "no",
        "--dir",
        dir,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let startupError: Error | undefined;
    redis.on("error", (error) => {
      startupError = error;
    });
    const closed = new Promise<void>((resolve) => redis.once("close", () => resolve()));
    redis.stdout.on("data", (chunk) => {
      output += chunk;
    });
    redis.stderr.on("data", (chunk) => {
      output += chunk;
    });
    let queue: Queue | undefined;
    let worker: Worker | undefined;
    try {
      await until(() => {
        if (startupError) throw startupError;
        assert.equal(redis.exitCode, null, output);
        return output.toLowerCase().includes("ready to accept connections");
      }, "private Redis startup");
      const connection = { path: socket, maxRetriesPerRequest: null };
      mock.module("../src/config.ts", {
        namedExports: { config: { universalisRequestsPerSecond: 20 } },
      });
      const { FAILED_SCAN_RETENTION_SECONDS, getItemScanJobId, TARGET_REGIONS } =
        await import("../src/services/jobQueue.js");
      queue = new Queue("scheduler-regression", {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 20 },
          removeOnFail: { age: FAILED_SCAN_RETENTION_SECONDS },
        },
      });
      const q = queue;
      mock.module("../src/services/jobQueue.ts", {
        namedExports: {
          FAILED_SCAN_RETENTION_SECONDS,
          getItemScanJobId,
          TARGET_REGIONS,
          getQueue: () => q,
        },
      });
      mock.module("../src/services/universalis.ts", { namedExports: { universalis: {} } });
      mock.module("../src/db/pool.ts", {
        namedExports: {
          pool: {
            async query(sql: string) {
              return {
                rows: sql.includes("SELECT item_id, region")
                  ? [{ item_id: 42, region: "Europe" }]
                  : [],
              };
            },
          },
        },
      });
      const { JobScheduler } = await import("../src/services/jobScheduler.js");
      let recovered = false;
      let invocations = 0;
      const errors: Error[] = [];
      q.on("error", (error) => errors.push(error));
      worker = new Worker(
        q.name,
        async () => {
          invocations++;
          if (!recovered) throw new Error("upstream unavailable");
        },
        { connection },
      );
      worker.on("error", (error) => errors.push(error));
      const id = getItemScanJobId(42, "Europe");
      await new JobScheduler().scheduleJobs();
      await until(
        async () => (await q.getJob(id))?.getState().then((s) => s === "failed") ?? false,
        "exhausted attempts",
      );
      assert.equal(invocations, 3);
      assert.equal((await q.getJob(id))?.attemptsMade, 3);
      recovered = true;

      // A fresh scheduler bypasses the scheduling cooldown, not the retention grace.
      await new JobScheduler().scheduleJobs();
      assert.equal(await (await q.getJob(id))?.getState(), "failed");
      assert.equal(invocations, 3);

      const client = await q.client;
      const old = Date.now() - FAILED_SCAN_RETENTION_SECONDS * 1000 - 1000;
      await client.hset(q.toKey(id), "finishedOn", old);
      await client.zadd(q.toKey("failed"), old, id);
      await q.addBulk([{ name: id, data: {}, opts: { jobId: id } }]);
      assert.equal(
        await (await q.getJob(id))?.getState(),
        "failed",
        "age alone does not free the ID",
      );

      const delayed = await q.add(
        "retry-in-flight",
        {},
        { jobId: "retry-in-flight", delay: 60_000 },
      );
      await new JobScheduler().scheduleJobs();
      assert.equal(await delayed.getState(), "delayed");
      assert.equal(
        await (await q.getJob(id))?.getState(),
        "failed",
        "outstanding retries prevent cleanup",
      );
      await delayed.remove();

      await new JobScheduler().scheduleJobs();
      await until(
        async () => (await q.getJob(id))?.getState().then((s) => s === "completed") ?? false,
        "scheduler recovery",
      );
      assert.equal(invocations, 4, "one new successful attempt, no unrelated failure needed");
      assert.equal(await q.getFailedCount(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await worker?.close(true);
      await queue?.close();
      redis.kill("SIGTERM");
      await closed;
      await rm(dir, { recursive: true, force: true });
      mock.restoreAll();
    }
  },
);
