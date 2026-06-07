import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { opportunityRoutes } from "./routes/opportunities.js";

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

try {
  await app.listen({
    port: config.port,
    host: "0.0.0.0"
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
