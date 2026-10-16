import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, afterEach, mock, test } from "node:test";
import type { WorldDcMapping } from "../src/services/worldDcMapping.js";

let offline = false;
let requests = 0;
mock.module("../src/services/universalis.ts", {
  namedExports: {
    UniversalisClient: class {
      async getWorlds() {
        requests++;
        if (offline) throw new Error("offline");
        return [{ id: 1, name: "Test World" }];
      }
      async getDataCenters() {
        requests++;
        if (offline) throw new Error("offline");
        return [{ name: "New DC", region: "Europe", worlds: [1] }];
      }
    },
  },
});
const { WorldDcMappingService } = await import("../src/services/worldDcMapping.js");
const seed: WorldDcMapping = {
  worldIdToDc: { 1: "Old DC" },
  dcRegions: { "Old DC": "Europe" },
  worlds: [{ id: 1, name: "Test World", dataCenter: "Old DC", region: "Europe" }],
  dataCenters: ["Old DC"],
  regions: ["Europe"],
  updatedAt: "2026-01-01T00:00:00.000Z",
};
let root: string;
let seedFile: string;
let cacheFile: string;
let service: InstanceType<typeof WorldDcMappingService>;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "world-mapping-"));
  seedFile = path.join(root, "apps/api/data/world-dc-mapping.json");
  cacheFile = path.join(root, "apps/api/data/cache/world-dc-mapping.json");
  await fs.mkdir(path.dirname(seedFile), { recursive: true });
  await fs.writeFile(seedFile, JSON.stringify(seed));
  service = new WorldDcMappingService(cacheFile, seedFile);
  offline = false;
  requests = 0;
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
after(() => mock.restoreAll());

test("offline first startup loads the versioned seed without network requests", async () => {
  offline = true;
  assert.deepEqual(await service.getMapping(), seed);
  assert.equal(requests, 0);
  await service.refresh();
  assert.deepEqual(await service.getMapping(), seed);
  await assert.rejects(fs.stat(cacheFile), { code: "ENOENT" });
});

test("invalid JSON runtime cache falls back to the seed offline", async () => {
  offline = true;
  await fs.mkdir(path.dirname(cacheFile));
  await fs.writeFile(cacheFile, "{");
  assert.deepEqual(await service.getMapping(), seed);
  assert.equal(requests, 0);
});

test("semantic refresh preserves the seed and leaves a fixture Git checkout clean", async () => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  await fs.copyFile(new URL("../../../.gitignore", import.meta.url), path.join(root, ".gitignore"));
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "-m",
    "test fixture",
  );
  const original = await fs.readFile(seedFile, "utf8");
  await service.refresh();
  const refreshed = await service.getMapping();
  assert.equal(refreshed.worldIdToDc[1], "New DC");
  assert.deepEqual(JSON.parse(await fs.readFile(cacheFile, "utf8")), refreshed);
  assert.equal(await fs.readFile(seedFile, "utf8"), original);
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "");
  assert.deepEqual(await fs.readdir(path.dirname(cacheFile)), ["world-dc-mapping.json"]);

  offline = true;
  const restarted = new WorldDcMappingService(cacheFile, seedFile);
  assert.deepEqual(await restarted.getMapping(), refreshed);
});

test("unchanged refresh retains runtime bytes and timestamp", async () => {
  await service.refresh();
  const original = await fs.readFile(cacheFile, "utf8");
  await service.refresh();
  assert.equal(await fs.readFile(cacheFile, "utf8"), original);
});

test("refresh can populate runtime storage when neither file exists", async () => {
  await fs.unlink(seedFile);
  const mapping = await service.getMapping();
  assert.equal(mapping.worldIdToDc[1], "New DC");
  assert.deepEqual(JSON.parse(await fs.readFile(cacheFile, "utf8")), mapping);
  await assert.rejects(fs.stat(seedFile), { code: "ENOENT" });
});
