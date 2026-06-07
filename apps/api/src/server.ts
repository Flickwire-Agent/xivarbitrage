import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { opportunityRoutes } from "./routes/opportunities.js";
import { runMigrations } from "./db/migrations.js";
import { getScheduler } from "./services/jobScheduler.js";
import { initializeWorker, closeWorker } from "./services/opportunityWorker.js";
import { closeQueue } from "./services/jobQueue.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

await app.register(opportunityRoutes, {
  prefix: "/api"
});

const webDistPath = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDistPath)) {
  await app.register(staticFiles, {
    root: webDistPath,
    wildcard: false
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
    await runMigrations(config.databaseUrl);
    await initializeWorker();

    const scheduler = getScheduler();
    await scheduler.initialize();

    // Schedule jobs on an interval (every 6 hours)
    setInterval(
      () => {
        void scheduler.scheduleJobs();
      },
      6 * 60 * 60 * 1000
    );
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
    host: "0.0.0.0"
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
