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
  private readonly limiter = new RateLimiter(config.universalisRequestsPerSecond);

  async getMarketableItemIds(): Promise<number[]> {
    return this.fetchJson<number[]>("/marketable");
  }

  async getWorlds(): Promise<UniversalisWorld[]> {
    return this.fetchJson<UniversalisWorld[]>("/worlds");
  }

  async getDataCenters(): Promise<UniversalisDataCenter[]> {
    return this.fetchJson<UniversalisDataCenter[]>("/data-centers");
  }

  async getCurrentData(
    regionOrWorld: string,
    itemId: number,
  ): Promise<UniversalisMarketData | null> {
    try {
      return await this.fetchJson<UniversalisMarketData>(
        `/${encodeURIComponent(regionOrWorld)}/${itemId}?listings=100&entries=100`,
      );
    } catch (error) {
      console.warn(
        `Universalis.getCurrentData: request failed for ${regionOrWorld}/${itemId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async fetchJson<T>(path: string): Promise<T> {
    return this.limiter.schedule(async () => {
      const response = await fetch(`${config.universalisBaseUrl}${path}`, {
        headers: {
          "User-Agent": "xiv-arbitrage/0.1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`Universalis request failed: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    });
  }
}

export const universalis = new UniversalisClient();
