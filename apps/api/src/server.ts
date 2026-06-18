import { config as loadEnv } from "dotenv";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { config } from "./config.js";
import { apiRoutes } from "./routes/api.js";
import { runMigrations } from "./db/migrations.js";
import { getScheduler } from "./services/jobScheduler.js";
import { initializeWorker, closeWorker } from "./services/opportunityWorker.js";
import { closeQueue } from "./services/jobQueue.js";
import { apiUsageMonitor } from "./services/apiUsageMonitor.js";

loadEnv({ path: new URL("../../../.env", import.meta.url).pathname });

const schemas = {
  BargainListing: {
    type: "object",
    required: [
      "itemId",
      "worldId",
      "worldName",
      "dataCenter",
      "pricePerUnit",
      "quantity",
      "recentAvgPrice",
      "discount",
      "discountPercent",
    ],
    properties: {
      itemId: { type: "integer" },
      worldId: { type: "integer" },
      worldName: { type: "string" },
      dataCenter: { type: "string" },
      pricePerUnit: { type: "integer" },
      quantity: { type: "integer" },
      recentAvgPrice: { type: "number" },
      discount: { type: "number" },
      discountPercent: { type: "integer" },
    },
  },
  BargainsResponse: {
    type: "object",
    required: ["generatedAt", "bargains"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      bargains: { type: "array", items: { $ref: "#/components/schemas/BargainListing" } },
    },
  },
  DcPriceInfo: {
    type: "object",
    required: ["dataCenter", "region", "avgPrice", "saleCount"],
    properties: {
      dataCenter: { type: "string" },
      region: { type: "string" },
      avgPrice: { type: "number" },
      saleCount: { type: "integer" },
    },
  },
  DcDisparity: {
    type: "object",
    required: ["itemId", "spread", "spreadPercent", "highDc", "lowDc", "allDcs"],
    properties: {
      itemId: { type: "integer" },
      spread: { type: "number" },
      spreadPercent: { type: "number" },
      highDc: { $ref: "#/components/schemas/DcPriceInfo" },
      lowDc: { $ref: "#/components/schemas/DcPriceInfo" },
      allDcs: { type: "array", items: { $ref: "#/components/schemas/DcPriceInfo" } },
    },
  },
  DcDisparityResponse: {
    type: "object",
    required: ["generatedAt", "disparities", "total", "page", "perPage", "totalPages"],
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      disparities: { type: "array", items: { $ref: "#/components/schemas/DcDisparity" } },
      total: { type: "integer" },
      page: { type: "integer" },
      perPage: { type: "integer" },
      totalPages: { type: "integer" },
    },
  },
  SaleRecord: {
    type: "object",
    required: ["worldId", "worldName", "pricePerUnit", "quantity", "soldAt"],
    properties: {
      worldId: { type: "integer" },
      worldName: { type: "string" },
      pricePerUnit: { type: "integer" },
      quantity: { type: "integer" },
      soldAt: { type: "string", format: "date-time" },
    },
  },
  ItemHistoryResponse: {
    type: "object",
    required: ["itemId", "sales", "worlds"],
    properties: {
      itemId: { type: "integer" },
      sales: { type: "array", items: { $ref: "#/components/schemas/SaleRecord" } },
      worlds: { type: "array", items: { type: "string" } },
    },
  },
  ItemListing: {
    type: "object",
    required: [
      "worldId",
      "worldName",
      "dataCenter",
      "pricePerUnit",
      "quantity",
      "recentAvgPrice",
      "discount",
      "discountPercent",
    ],
    properties: {
      worldId: { type: "integer" },
      worldName: { type: "string" },
      dataCenter: { type: "string" },
      pricePerUnit: { type: "integer" },
      quantity: { type: "integer" },
      recentAvgPrice: { type: "number" },
      discount: { type: "number" },
      discountPercent: { type: "integer" },
    },
  },
  ListingsResponse: {
    type: "object",
    required: ["itemId", "listings", "saleStats"],
    properties: {
      itemId: { type: "integer" },
      listings: { type: "array", items: { $ref: "#/components/schemas/ItemListing" } },
      saleStats: {
        type: "object",
        required: ["avgPrice", "count", "perDataCenter"],
        properties: {
          avgPrice: { type: "number" },
          count: { type: "integer" },
          perDataCenter: {
            type: "object",
            additionalProperties: {
              type: "object",
              required: ["avgPrice", "count"],
              properties: {
                avgPrice: { type: "number" },
                count: { type: "integer" },
              },
            },
          },
        },
      },
    },
  },
  WorldInfo: {
    type: "object",
    required: ["id", "name", "dataCenter", "region"],
    properties: {
      id: { type: "integer" },
      name: { type: "string" },
      dataCenter: { type: "string" },
      region: { type: "string" },
    },
  },
  WorldsResponse: {
    type: "object",
    required: ["worlds", "dataCenters", "regions", "worldIdToDc", "updatedAt"],
    properties: {
      worlds: { type: "array", items: { $ref: "#/components/schemas/WorldInfo" } },
      dataCenters: { type: "array", items: { type: "string" } },
      regions: { type: "array", items: { type: "string" } },
      worldIdToDc: { type: "object", additionalProperties: { type: "string" } },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  HealthResponse: {
    type: "object",
    required: ["ok", "database", "redis"],
    properties: {
      ok: { type: "boolean" },
      database: { type: "boolean" },
      redis: { type: "boolean" },
    },
  },
  WorkerStatusResponse: {
    type: "object",
    properties: {
      queue: { type: "object", additionalProperties: true },
      items: { type: "object", additionalProperties: true },
      jobs24h: { type: "object", additionalProperties: { type: "integer" } },
      lastFullScan: { type: "string", format: "date-time" },
      error: { type: "string" },
    },
  },
  UsageResponse: {
    type: "object",
    additionalProperties: true,
  },
  ErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
    },
  },
} as const;

function jsonResponse(description: string, schemaRef: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: schemaRef },
      },
    },
  };
}

const app = Fastify({
  logger: true,
});

await app.register(cors, {
  origin: true,
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.status(400).send({ error: error.issues.map((issue) => issue.message).join(", ") });
  }

  app.log.error(error);
  const responseError = error as Error & { statusCode?: number };
  const statusCode =
    responseError.statusCode && responseError.statusCode >= 400 ? responseError.statusCode : 500;
  return reply
    .status(statusCode)
    .send({ error: statusCode === 500 ? "Internal server error" : responseError.message });
});

app.addHook("onResponse", async (request, reply) => {
  const url = request.raw.url ?? "";
  if (!url.startsWith("/api/")) return;
  if (url === "/api/monitoring/usage") return;

  const forwarded = request.headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string" ? (forwarded.split(",")[0]?.trim() ?? request.ip) : request.ip;

  apiUsageMonitor.record({
    ip,
    endpoint: url,
    method: request.method,
    statusCode: reply.statusCode,
    responseTimeMs: reply.elapsedTime,
    userAgent: (request.headers["user-agent"] as string) ?? "",
    origin: (request.headers["origin"] as string) ?? (request.headers["referer"] as string) ?? "",
    timestamp: Date.now(),
  });
});

apiUsageMonitor.start();

await app.register(apiRoutes, {
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
        "DC price disparities and market bargains on the Final Fantasy XIV market board. Scans ~10,000 items across NA, EU, and OCE regions. Cache-backed endpoints refresh every 15 minutes.",
    },
    servers: [{ url: baseUrl }],
    externalDocs: {
      description: "AI agent usage guide",
      url: `${baseUrl}/llms.txt`,
    },
    paths: {
      "/api/bargains": {
        get: {
          summary: "Market bargains",
          description:
            "Items with current listings priced at least 20% below the global IQR average price.",
          responses: {
            "200": jsonResponse(
              "List of bargain listings",
              "#/components/schemas/BargainsResponse",
            ),
          },
        },
      },
      "/api/dc-disparities": {
        get: {
          summary: "Data center price disparities",
          description:
            "DC average price disparities across all marketable items. Items without sale data show no info.",
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
          responses: {
            "200": jsonResponse(
              "Paginated list of DC price disparities",
              "#/components/schemas/DcDisparityResponse",
            ),
            "400": jsonResponse("Invalid query parameters", "#/components/schemas/ErrorResponse"),
          },
        },
      },
      "/api/items/{itemId}/history": {
        get: {
          summary: "Item sale history",
          parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": jsonResponse(
              "Sale history for the item",
              "#/components/schemas/ItemHistoryResponse",
            ),
            "400": jsonResponse("Invalid item ID", "#/components/schemas/ErrorResponse"),
          },
        },
      },
      "/api/items/{itemId}/listings": {
        get: {
          summary: "Item listings below average",
          description: "Current listings priced below the 14-day data center average.",
          parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": jsonResponse(
              "Discounted listings for the item",
              "#/components/schemas/ListingsResponse",
            ),
            "400": jsonResponse("Invalid item ID", "#/components/schemas/ErrorResponse"),
          },
        },
      },
      "/api/worlds": {
        get: {
          summary: "World/DC/region mapping",
          responses: {
            "200": jsonResponse("Complete world mapping", "#/components/schemas/WorldsResponse"),
          },
        },
      },
      "/api/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": jsonResponse("Service health status", "#/components/schemas/HealthResponse"),
            "503": jsonResponse("Dependency outage", "#/components/schemas/ErrorResponse"),
          },
        },
      },
      "/api/worker/status": {
        get: {
          summary: "Worker status",
          responses: {
            "200": jsonResponse(
              "Queue depth and scan progress",
              "#/components/schemas/WorkerStatusResponse",
            ),
          },
        },
      },
      "/api/monitoring/usage": {
        get: {
          summary: "API usage monitoring",
          description:
            "Third-party API consumption metrics. Tracks requests by IP, endpoint, status code, and response time over configurable time windows.",
          parameters: [
            {
              name: "hours",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 168, default: 24 },
              description: "Number of hours to look back (max 168 = 7 days)",
            },
          ],
          responses: {
            "200": jsonResponse(
              "Usage summary with per-hour request counts, top endpoints, top consumers by IP, status code distribution, and average response times",
              "#/components/schemas/UsageResponse",
            ),
          },
        },
      },
    },
    components: { schemas },
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
    wildcard: true,
    cacheControl: false,
    setHeaders: (res, filePath) => {
      // Vite emits hashed asset filenames like index-Bm8n5KMu.js.
      // These can be cached forever because the content hash changes on every build.
      if (/-[A-Za-z0-9_-]{8,}\.(js|css)(\.map)?$/.test(basename(filePath))) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        // index.html and other non-hashed files must never be long-cached so
        // users always pick up a fresh build on their next visit.
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    },
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
  apiUsageMonitor.stop();
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
  apiUsageMonitor.stop();
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
