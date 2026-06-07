import { config } from "../config.js";
import { RateLimiter } from "./rateLimiter.js";

export interface UniversalisListing {
  pricePerUnit: number;
  quantity: number;
  worldID?: number;
  worldName?: string;
}

export interface UniversalisSale {
  pricePerUnit: number;
  quantity: number;
  worldID?: number;
  worldName?: string;
}

export interface UniversalisMarketData {
  itemID: number;
  listings?: UniversalisListing[];
  recentHistory?: UniversalisSale[];
  averagePrice?: number;
  averagePriceNQ?: number;
}

export class UniversalisClient {
  private readonly limiter = new RateLimiter(config.universalisRequestsPerSecond);

  async getMarketableItemIds(): Promise<number[]> {
    return this.fetchJson<number[]>("/marketable");
  }

  async getCurrentData(regionOrWorld: string, itemId: number): Promise<UniversalisMarketData> {
    return this.fetchJson<UniversalisMarketData>(
      `/${encodeURIComponent(regionOrWorld)}/${itemId}?listings=100&entriesToReturn=20`
    );
  }

  private async fetchJson<T>(path: string): Promise<T> {
    return this.limiter.schedule(async () => {
      const response = await fetch(`${config.universalisBaseUrl}${path}`, {
        headers: {
          "User-Agent": "xiv-arbitrage/0.1.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Universalis request failed: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    });
  }
}
