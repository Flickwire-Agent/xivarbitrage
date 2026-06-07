import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ArbitrageCache } from "../services/arbitrageCache.js";

const querySchema = z.object({
  highWorld: z.string().optional(),
  highDataCenter: z.string().optional(),
  category: z.string().optional(),
  profile: z.enum(["all", "high-volume", "high-arbitrage"]).optional(),
  minVolume: z.coerce.number().int().nonnegative().optional(),
  minSpread: z.coerce.number().nonnegative().optional(),
  sort: z.enum(["best", "spread", "spreadPercent", "volume", "velocity"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  refresh: z.coerce.boolean().optional()
});

export async function opportunityRoutes(app: FastifyInstance) {
  const arbitrage = new ArbitrageCache();
  arbitrage.start();

  app.get("/health", async () => ({ ok: true }));

  app.get("/opportunities", async (request) => {
    const { refresh, ...filters } = querySchema.parse(request.query);
    if (refresh) {
      await arbitrage.refresh();
    }

    return arbitrage.get(filters);
  });
}
