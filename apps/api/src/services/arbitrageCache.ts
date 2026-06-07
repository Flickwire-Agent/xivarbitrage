import type { ArbitrageOpportunity, OpportunityFilters, OpportunityResponse } from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import { ArbitrageService } from "./arbitrage.js";

export class ArbitrageCache {
  private latest: ArbitrageOpportunity[] = [];
  private generatedAt = new Date(0).toISOString();
  private refreshPromise: Promise<void> | null = null;

  constructor(private readonly service = new ArbitrageService()) {}

  start() {
    void this.refresh();
    setInterval(() => {
      void this.refresh();
    }, config.arbitrageRefreshMinutes * 60 * 1000).unref();
  }

  async get(filters: OpportunityFilters): Promise<OpportunityResponse> {
    if (this.latest.length === 0) {
      await this.refresh();
    }

    return this.service.createResponse(this.latest, filters, this.generatedAt);
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.service
      .scanOpportunities(config.arbitrageItemLimit)
      .then((opportunities) => {
        this.latest = opportunities;
        this.generatedAt = new Date().toISOString();
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }
}
