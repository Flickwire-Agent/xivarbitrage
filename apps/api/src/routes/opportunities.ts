import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ArbitrageService } from "../services/arbitrage.js";

const querySchema = z.object({
  highWorld: z.string().optional(),
  highDataCenter: z.string().optional(),
  category: z.string().optional(),
  profile: z.enum(["all", "high-volume", "high-arbitrage"]).optional(),
  minVolume: z.coerce.number().int().nonnegative().optional(),
  minSpread: z.coerce.number().nonnegative().optional(),
  sort: z.enum(["best", "spread", "spreadPercent", "volume", "velocity"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

export async function opportunityRoutes(app: FastifyInstance) {
  const arbitrage = new ArbitrageService();

  app.get("/health", async () => ({ ok: true }));

  app.get("/opportunities", async (request) => {
    const filters = querySchema.parse(request.query);
    return arbitrage.findOpportunities(filters);
  });
}
