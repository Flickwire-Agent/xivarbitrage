import { config } from "../config.js";
import { rateLimiter } from "./rateLimiter.js";

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
  timestamp?: number;
}

export interface UniversalisMarketData {
  itemID: number;
  listings?: UniversalisListing[];
  recentHistory?: UniversalisSale[];
  averagePrice?: number;
  averagePriceNQ?: number;
}

export interface UniversalisWorld {
  id: number;
  name: string;
}

export interface UniversalisDataCenter {
  name: string;
  region: string;
  worlds: number[];
}

export class UniversalisClient {
  async getMarketableItemIds(): Promise<number[]> {
    return this.fetchJson<number[]>("/marketable");
  }

  async getWorlds(): Promise<UniversalisWorld[]> {
    return this.fetchJson<UniversalisWorld[]>("/worlds");
  }

  async getDataCenters(): Promise<UniversalisDataCenter[]> {
    return this.fetchJson<UniversalisDataCenter[]>("/data-centers");
  }

  async getCurrentData(regionOrWorld: string, itemId: number): Promise<UniversalisMarketData> {
    // Let the worker reject the attempt so BullMQ applies its bounded retry policy.
    const data = await this.fetchJson<UniversalisMarketData>(
      `/${encodeURIComponent(regionOrWorld)}/${itemId}?listings=100&entries=100`,
    );
    if (!data || data.itemID !== itemId) {
      throw new Error(`Universalis returned invalid market data for ${regionOrWorld}/${itemId}`);
    }
    return data;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    return rateLimiter.schedule(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(`${config.universalisBaseUrl}${path}`, {
          headers: {
            "User-Agent": "xiv-arbitrage/0.1.0",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Universalis request failed: ${response.status} ${response.statusText}`);
        }

        return (await response.json()) as T;
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}

export const universalis = new UniversalisClient();
