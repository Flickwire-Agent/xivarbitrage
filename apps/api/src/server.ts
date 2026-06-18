import { config as loadEnv } from "dotenv";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { opportunityRoutes } from "./routes/opportunities.js";
import { runMigrations } from "./db/migrations.js";
import { getScheduler } from "./services/jobScheduler.js";
import { initializeWorker, closeWorker } from "./services/opportunityWorker.js";
import { closeQueue } from "./services/jobQueue.js";

loadEnv({ path: new URL("../../../.env", import.meta.url).pathname });

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

await app.register(opportunityRoutes, {
  prefix: "/api",
});

app.get("/api/openapi.json", async (request, reply) => {
  const baseUrl = `https://${request.hostname}`;
  return reply.type("application/json").send({
    openapi: "3.1.0",
    info: {
      title: "XIV Arbitrage API",
      version: "1.0.0",
      description:
        "Find profitable arbitrage opportunities on the Final Fantasy XIV market board. Scans ~10,000 items across NA, EU, and OCE regions.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/opportunities": {
        get: {
          summary: "Arbitrage opportunities",
          description: "Current arbitrage opportunities, cached and refreshed every 15 minutes.",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["best", "spread", "spreadPercent", "volume", "velocity"],
              },
            },
            { name: "highWorld", in: "query", schema: { type: "string" } },
            { name: "highDataCenter", in: "query", schema: { type: "string" } },
            { name: "category", in: "query", schema: { type: "string" } },
            {
              name: "profile",
              in: "query",
              schema: { type: "string", enum: ["all", "high-volume", "high-arbitrage"] },
            },
            { name: "minVolume", in: "query", schema: { type: "integer" } },
            { name: "minSpread", in: "query", schema: { type: "number" } },
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "perPage", in: "query", schema: { type: "integer", maximum: 100 } },
            { name: "includeHistory", in: "query", schema: { type: "boolean" } },
          ],
          responses: { "200": { description: "Paginated list of arbitrage opportunities" } },
        },
      },
      "/api/bargains": {
        get: {
          summary: "Market bargains",
          description: "Items listed significantly below their data center average price.",
          responses: { "200": { description: "List of bargain listings" } },
        },
      },
      "/api/dc-disparities": {
        get: {
          summary: "Data center price disparities",
          description: "Items with the largest price differences between data centers.",
          parameters: [
            { name: "highDc", in: "query", schema: { type: "string" } },
            { name: "lowDc", in: "query", schema: { type: "string" } },
            { name: "region", in: "query", schema: { type: "string" } },
            {
              name: "sort",
              in: "query",
              schema: { type: "string", enum: ["spread", "spreadPercent"] },
            },
            { name: "minSpread", in: "query", schema: { type: "number" } },
            { name: "minSpreadPercent", in: "query", schema: { type: "number" } },
            { name: "page", in: "query", schema: { type: "integer" } },
            { name: "perPage", in: "query", schema: { type: "integer", maximum: 200 } },
          ],
          responses: { "200": { description: "Paginated list of DC price disparities" } },
        },
      },
      "/api/items/{itemId}/history": {
        get: {
          summary: "Item sale history",
          parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Sale history for the item" } },
        },
      },
      "/api/items/{itemId}/listings": {
        get: {
          summary: "Item listings below average",
          description: "Current listings priced below the 14-day data center average.",
          parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Discounted listings for the item" } },
        },
      },
      "/api/worlds": {
        get: {
          summary: "World/DC/region mapping",
          responses: { "200": { description: "Complete world mapping" } },
        },
      },
      "/api/health": {
        get: {
          summary: "Health check",
          responses: { "200": { description: "Service health status" } },
        },
      },
      "/api/worker/status": {
        get: {
          summary: "Worker status",
          responses: { "200": { description: "Queue depth and scan progress" } },
        },
      },
    },
  });
});

const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));

const aiPluginPath = join(webDistPath, ".well-known", "ai-plugin.json");
if (existsSync(aiPluginPath)) {
  const aiPluginJson = JSON.parse(readFileSync(aiPluginPath, "utf-8"));
  app.get("/.well-known/ai-plugin.json", async (request, reply) => {
    return reply.type("application/json").send(aiPluginJson);
  });
}
if (existsSync(webDistPath)) {
  await app.register(staticFiles, {
    root: webDistPath,
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.status(404).send({ error: "Not found" });
    }

    return reply.sendFile("index.html");
  });
}

// Initialize database and background jobs
if (config.databaseUrl) {
  try {
    await runMigrations();
    await initializeWorker();

    const scheduler = getScheduler();
    await scheduler.initialize();

    // Continuously re-schedule scans as fast as the API rate limit allows.
    // The scheduler's internal cooldown prevents overlapping passes, so we
    // just poll every 30 seconds to kick off the next cycle when ready.
    async function scheduleLoop(): Promise<void> {
      await scheduler.scheduleJobs();
      setTimeout(scheduleLoop, 30_000);
    }

    scheduleLoop();

    // Periodic cleanup of old data
    const { marketSnapshotStore } = await import("./services/marketSnapshotStore.js");

    // Cull stale market snapshots and old sale records every hour
    async function cleanupLoop(): Promise<void> {
      try {
        const staleCount = await marketSnapshotStore.deleteStale();
        const saleCount = await marketSnapshotStore.pruneOldSales();
        if (staleCount > 0 || saleCount > 0) {
          console.log(
            `[Cleanup] Removed ${staleCount} stale snapshots, ${saleCount} old sale records`,
          );
        }
      } catch (error) {
        console.error(`[Cleanup] Error: ${error}`);
      }
      setTimeout(cleanupLoop, 3_600_000); // every hour
    }

    cleanupLoop();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  app.log.info("SIGTERM received, shutting down gracefully...");
  await closeWorker();
  await closeQueue();
  if (scheduler) {
    await (await import("./services/jobScheduler.js")).getScheduler().close();
  }
  await app.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  app.log.info("SIGINT received, shutting down gracefully...");
  await closeWorker();
  await closeQueue();
  if (scheduler) {
    await (await import("./services/jobScheduler.js")).getScheduler().close();
  }
  await app.close();
  process.exit(0);
});

// Helper to access scheduler from closure
let scheduler: any = null;

try {
  await app.listen({
    port: config.port,
    host: "0.0.0.0",
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
