import type {
  ArbitrageOpportunity,
  OpportunityFilters,
  OpportunityResponse,
  WorldPrice
} from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import type { UniversalisMarketData } from "./universalis.js";
import { UniversalisClient } from "./universalis.js";
import { WorldCatalog } from "./worldCatalog.js";
import { XivApiClient } from "./xivapi.js";

export class ArbitrageService {
  constructor(
    private readonly universalis = new UniversalisClient(),
    private readonly xivapi = new XivApiClient(),
    private readonly worldCatalog = new WorldCatalog(universalis)
  ) {}

  async findOpportunities(filters: OpportunityFilters): Promise<OpportunityResponse> {
    const opportunities = await this.scanOpportunities(filters.limit ?? config.arbitrageItemLimit);
    return this.createResponse(opportunities, filters, new Date().toISOString());
  }

  async scanOpportunities(limit: number = config.arbitrageItemLimit): Promise<ArbitrageOpportunity[]> {
    const marketableIds = await this.universalis.getMarketableItemIds();
    const idsToInspect = marketableIds.slice(0, limit);
    const regions = await this.worldCatalog.getRegions();
    const worldById = await this.worldCatalog.getWorldById();
    const regionItemPairs = regions.flatMap((region) => idsToInspect.map((itemId) => ({ region, itemId })));
    const regionalOpportunities = (
      await mapConcurrent(regionItemPairs, config.arbitrageMaxConcurrency, ({ region, itemId }) =>
        this.evaluateItem(region, itemId, worldById)
      )
    ).filter((opportunity): opportunity is ArbitrageOpportunity => opportunity !== null);

    return this.bestOpportunityPerItem(regionalOpportunities);
  }

  createResponse(
    opportunities: ArbitrageOpportunity[],
    filters: OpportunityFilters,
    generatedAt: string
  ): OpportunityResponse {
    const filtered = this.applyFilters(opportunities, filters);
    const sorted = this.sort(filtered, filters.sort ?? "best");

    return {
      generatedAt,
      filters,
      opportunities: sorted.slice(0, filters.limit ?? 50),
      worlds: [...new Set(opportunities.flatMap((opportunity) => [opportunity.low.worldName, opportunity.high.worldName]))].sort(),
      dataCenters: [...new Set(opportunities.flatMap((opportunity) => [opportunity.low.dataCenter, opportunity.high.dataCenter]))].sort(),
      categories: [...new Set(opportunities.map((opportunity) => opportunity.item.category).filter(isDefined))].sort()
    };
  }

  private async evaluateItem(
    region: string,
    itemId: number,
    worldById: Map<number, { name: string; dataCenter: string }>
  ): Promise<ArbitrageOpportunity | null> {
    const market = await this.universalis.getCurrentData(region, itemId);
    const prices = this.extractWorldPrices(market, worldById);

    if (prices.length < 2) {
      return null;
    }

    const low = prices.reduce((best, price) => (price.pricePerUnit < best.pricePerUnit ? price : best));
    const high = prices.reduce((best, price) => (price.pricePerUnit > best.pricePerUnit ? price : best));
    const spread = high.pricePerUnit - low.pricePerUnit;

    if (spread <= 0) {
      return null;
    }

    const recentSales = market.recentHistory?.reduce((sum, sale) => sum + Math.max(1, sale.quantity), 0) ?? 0;
    const averageSalePrice = market.averagePriceNQ ?? market.averagePrice ?? 0;
    const item = await this.xivapi.getItemDetails(itemId);

    return {
      itemId,
      item,
      low,
      high,
      spread,
      spreadPercent: low.pricePerUnit > 0 ? (spread / low.pricePerUnit) * 100 : 0,
      recentSales,
      averageSalePrice,
      velocityScore: recentSales * Math.max(1, averageSalePrice),
      profitScore: spread * Math.max(1, recentSales),
      updatedAt: new Date().toISOString()
    };
  }

  private extractWorldPrices(
    market: UniversalisMarketData,
    worldById: Map<number, { name: string; dataCenter: string }>
  ): WorldPrice[] {
    const byWorld = new Map<number, WorldPrice>();

    for (const listing of market.listings ?? []) {
      const worldId = listing.worldID;
      if (!worldId) {
        continue;
      }

      const world = worldById.get(worldId);
      if (!world) {
        continue;
      }

      const existing = byWorld.get(worldId);
      if (!existing || listing.pricePerUnit < existing.pricePerUnit) {
        byWorld.set(worldId, {
          worldId,
          worldName: listing.worldName ?? world.name,
          dataCenter: world.dataCenter,
          pricePerUnit: listing.pricePerUnit,
          quantity: listing.quantity
        });
      }
    }

    return [...byWorld.values()];
  }

  private applyFilters(
    opportunities: ArbitrageOpportunity[],
    filters: OpportunityFilters
  ): ArbitrageOpportunity[] {
    return opportunities.filter((opportunity) => {
      if (filters.highWorld && opportunity.high.worldName !== filters.highWorld) {
        return false;
      }
      if (filters.highDataCenter && opportunity.high.dataCenter !== filters.highDataCenter) {
        return false;
      }
      if (filters.category && opportunity.item.category !== filters.category) {
        return false;
      }
      if (filters.minVolume && opportunity.recentSales < filters.minVolume) {
        return false;
      }
      if (filters.minSpread && opportunity.spread < filters.minSpread) {
        return false;
      }
      if (filters.profile === "high-volume" && opportunity.recentSales < 10) {
        return false;
      }
      if (filters.profile === "high-arbitrage" && opportunity.spreadPercent < 50) {
        return false;
      }
      return true;
    });
  }

  private sort(opportunities: ArbitrageOpportunity[], sort: NonNullable<OpportunityFilters["sort"]>) {
    const selectors = {
      best: (opportunity: ArbitrageOpportunity) => opportunity.profitScore,
      spread: (opportunity: ArbitrageOpportunity) => opportunity.spread,
      spreadPercent: (opportunity: ArbitrageOpportunity) => opportunity.spreadPercent,
      volume: (opportunity: ArbitrageOpportunity) => opportunity.recentSales,
      velocity: (opportunity: ArbitrageOpportunity) => opportunity.velocityScore
    };

    return [...opportunities].sort((a, b) => selectors[sort](b) - selectors[sort](a));
  }

  private bestOpportunityPerItem(opportunities: ArbitrageOpportunity[]): ArbitrageOpportunity[] {
    const byItem = new Map<number, ArbitrageOpportunity>();

    for (const opportunity of opportunities) {
      const current = byItem.get(opportunity.itemId);
      if (!current || opportunity.profitScore > current.profitScore) {
        byItem.set(opportunity.itemId, opportunity);
      }
    }

    return [...byItem.values()];
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker())
  );

  return results;
}
