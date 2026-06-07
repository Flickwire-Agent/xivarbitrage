import cors from "@fastify/cors";
import Fastify from "fastify";
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

try {
  await app.listen({
    port: config.port,
    host: "0.0.0.0"
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
