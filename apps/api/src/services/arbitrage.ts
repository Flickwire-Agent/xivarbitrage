import type {
  ArbitrageOpportunity,
  OpportunityFilters,
  OpportunityResponse,
  WorldPrice,
} from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import type { UniversalisMarketData } from "./universalis.js";
import { WorldCatalog } from "./worldCatalog.js";
import { XivApiClient } from "./xivapi.js";

interface EnrichedOpportunity extends ArbitrageOpportunity {
  itemCategory?: string;
}

export class ArbitrageService {
  private worldCatalog: WorldCatalog;
  private xivapi: XivApiClient;

  constructor(worldCatalog?: WorldCatalog, xivapi?: XivApiClient) {
    this.worldCatalog = worldCatalog || new WorldCatalog();
    this.xivapi = xivapi || new XivApiClient();
  }

  async findOpportunities(filters: OpportunityFilters): Promise<OpportunityResponse> {
    const opportunities = await this.scanOpportunitiesFromDb();
    return this.createResponse(opportunities, filters, new Date().toISOString());
  }

  async scanOpportunitiesFromDb(): Promise<ArbitrageOpportunity[]> {
    if (!pool) {
      return [];
    }

    try {
      const worldById = await this.worldCatalog.getWorldById();

      const result = await pool.query<{ item_id: number; regions: string }>(
        `
        SELECT 
          item_id,
          array_agg(DISTINCT region) as regions
        FROM market_snapshots
        WHERE fetched_at > now() - interval '24 hours'
        GROUP BY item_id
        LIMIT 10000
        `,
      );

      const itemsToEvaluate = result.rows;

      if (itemsToEvaluate.length === 0) {
        return [];
      }

      const itemIds = itemsToEvaluate.map((r) => r.item_id);
      const snapshotMap = new Map<number, { data: UniversalisMarketData; region: string }[]>();

      const batchSize = 500;
      for (let i = 0; i < itemIds.length; i += batchSize) {
        const batch = itemIds.slice(i, i + batchSize);
        const batchResult = await pool.query<{
          item_id: number;
          data: UniversalisMarketData;
          region: string;
        }>(
          `SELECT item_id, data, region
           FROM market_snapshots
           WHERE item_id = ANY($1::int[])
             AND fetched_at > now() - interval '24 hours'`,
          [batch],
        );

        for (const row of batchResult.rows) {
          let entries = snapshotMap.get(row.item_id);
          if (!entries) {
            entries = [];
            snapshotMap.set(row.item_id, entries);
          }
          entries.push({ data: row.data, region: row.region });
        }
      }

      const opportunities: (EnrichedOpportunity | null)[] = [];
      const chunkSize = 100;
      for (let i = 0; i < itemsToEvaluate.length; i += chunkSize) {
        const chunk = itemsToEvaluate.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(({ item_id: itemId, regions: regionsStr }) => {
            const regions =
              typeof regionsStr === "string" ? JSON.parse(regionsStr) : (regionsStr as string[]);
            const snapshots = snapshotMap.get(itemId) ?? [];
            return this.evaluateItemFromSnapshots(itemId, regions, snapshots, worldById);
          }),
        );
        opportunities.push(...chunkResults);
      }

      return opportunities.filter((opp): opp is ArbitrageOpportunity => opp !== null);
    } catch (error) {
      console.error(`ArbitrageService: Error scanning opportunities from DB: ${error}`);
      return [];
    }
  }

  private async evaluateItemFromSnapshots(
    itemId: number,
    regions: string[],
    snapshots: { data: UniversalisMarketData; region: string }[],
    worldById: Map<number, { name: string; dataCenter: string }>,
  ): Promise<EnrichedOpportunity | null> {
    try {
      if (snapshots.length === 0) {
        return null;
      }

      const allListingPrices = new Map<number, WorldPrice>();
      const allSoldPrices = new Map<number, WorldPrice>();
      let totalRecentSales = 0;
      let totalAveragePrice = 0;
      let dataPointCount = 0;

      for (const { data } of snapshots) {
        const listingPrices = this.extractWorldPrices(data, worldById);

        for (const price of listingPrices) {
          const existing = allListingPrices.get(price.worldId);
          if (!existing || price.pricePerUnit < existing.pricePerUnit) {
            allListingPrices.set(price.worldId, price);
          }
        }

        const soldPrices = this.extractSoldPrices(data, worldById);

        for (const price of soldPrices) {
          const existing = allSoldPrices.get(price.worldId);
          if (!existing || price.pricePerUnit > existing.pricePerUnit) {
            allSoldPrices.set(price.worldId, price);
          }
        }

        if (data.recentHistory) {
          totalRecentSales += data.recentHistory.reduce(
            (sum, sale) => sum + Math.max(1, sale.quantity),
            0,
          );
        }

        if (data.averagePriceNQ || data.averagePrice) {
          totalAveragePrice += data.averagePriceNQ ?? data.averagePrice ?? 0;
          dataPointCount++;
        }
      }

      const lowPrices = [...allListingPrices.values()];
      const highPrices =
        allSoldPrices.size > 0 ? [...allSoldPrices.values()] : [...allListingPrices.values()];

      if (lowPrices.length < 1 || highPrices.length < 1) {
        return null;
      }

      const low = lowPrices.reduce((best, price) =>
        price.pricePerUnit < best.pricePerUnit ? price : best,
      );
      const high = highPrices.reduce((best, price) =>
        price.pricePerUnit > best.pricePerUnit ? price : best,
      );
      const grossSpread = high.pricePerUnit - low.pricePerUnit;
      const grossSpreadPercent = low.pricePerUnit > 0 ? (grossSpread / low.pricePerUnit) * 100 : 0;

      const netBuyPrice = Math.round(low.pricePerUnit * (1 + config.marketBuyTaxRate));
      const netSellPrice = Math.round(high.pricePerUnit * (1 - config.marketSellTaxRate));
      const spread = netSellPrice - netBuyPrice;
      const spreadPercent = netBuyPrice > 0 ? (spread / netBuyPrice) * 100 : 0;

      if (spread <= 0) {
        return null;
      }

      const recentSales = totalRecentSales;
      const averageSalePrice =
        dataPointCount > 0 ? Math.round(totalAveragePrice / dataPointCount) : 0;

      if (recentSales < config.arbitrageMinSales) {
        return null;
      }

      const priceRatio =
        averageSalePrice > 0
          ? high.pricePerUnit / averageSalePrice
          : low.pricePerUnit > 0
            ? high.pricePerUnit / low.pricePerUnit
            : 0;

      if (priceRatio > config.arbitrageMaxPriceRatio) {
        return null;
      }

      const item = await this.xivapi.getItemDetails(itemId);

      return {
        itemId,
        itemCategory: item.category,
        low,
        high,
        grossSpread,
        grossSpreadPercent,
        spread,
        spreadPercent,
        netBuyPrice,
        netSellPrice,
        recentSales,
        averageSalePrice,
        velocityScore: recentSales * Math.max(1, averageSalePrice),
        profitScore: spread * Math.max(1, recentSales),
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`ArbitrageService: Error evaluating item ${itemId}: ${error}`);
      return null;
    }
  }

  createResponse(
    opportunities: EnrichedOpportunity[],
    filters: OpportunityFilters,
    generatedAt: string,
  ): OpportunityResponse {
    const filtered = this.applyFilters(opportunities, filters);
    const sorted = this.sort(filtered, filters.sort ?? "best");

    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 50));
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const clampedPage = Math.min(page, totalPages);
    const start = (clampedPage - 1) * perPage;
    const paginated = sorted.slice(start, start + perPage);

    return {
      generatedAt,
      filters,
      opportunities: paginated,
      worlds: [
        ...new Set(
          opportunities.flatMap((opportunity) => [
            opportunity.low.worldName,
            opportunity.high.worldName,
          ]),
        ),
      ].sort(),
      dataCenters: [
        ...new Set(
          opportunities.flatMap((opportunity) => [
            opportunity.low.dataCenter,
            opportunity.high.dataCenter,
          ]),
        ),
      ].sort(),
      categories: [
        ...new Set(opportunities.map((opportunity) => opportunity.itemCategory).filter(isDefined)),
      ].sort(),
      total,
      page: clampedPage,
      perPage,
      totalPages,
    };
  }

  private extractWorldPrices(
    market: UniversalisMarketData,
    worldById: Map<number, { name: string; dataCenter: string }>,
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
          quantity: listing.quantity,
        });
      }
    }

    return [...byWorld.values()];
  }

  private extractSoldPrices(
    market: UniversalisMarketData,
    worldById: Map<number, { name: string; dataCenter: string }>,
  ): WorldPrice[] {
    const byWorld = new Map<number, WorldPrice>();

    for (const sale of market.recentHistory ?? []) {
      const worldId = sale.worldID;
      if (!worldId) {
        continue;
      }

      const world = worldById.get(worldId);
      if (!world) {
        continue;
      }

      const existing = byWorld.get(worldId);
      if (!existing || sale.pricePerUnit > existing.pricePerUnit) {
        byWorld.set(worldId, {
          worldId,
          worldName: sale.worldName ?? world.name,
          dataCenter: world.dataCenter,
          pricePerUnit: sale.pricePerUnit,
          quantity: sale.quantity,
        });
      }
    }

    return [...byWorld.values()];
  }

  private applyFilters(
    opportunities: EnrichedOpportunity[],
    filters: OpportunityFilters,
  ): ArbitrageOpportunity[] {
    const filtered = opportunities.filter((opportunity) => {
      if (filters.highWorld && opportunity.high.worldName !== filters.highWorld) {
        return false;
      }
      if (filters.highDataCenter && opportunity.high.dataCenter !== filters.highDataCenter) {
        return false;
      }
      if (filters.category && opportunity.itemCategory !== filters.category) {
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

    return filtered.map(({ itemCategory: _, ...rest }) => rest);
  }

  private sort(
    opportunities: ArbitrageOpportunity[],
    sort: NonNullable<OpportunityFilters["sort"]>,
  ) {
    const selectors = {
      best: (opportunity: ArbitrageOpportunity) => opportunity.profitScore,
      spread: (opportunity: ArbitrageOpportunity) => opportunity.spread,
      spreadPercent: (opportunity: ArbitrageOpportunity) => opportunity.spreadPercent,
      volume: (opportunity: ArbitrageOpportunity) => opportunity.recentSales,
      velocity: (opportunity: ArbitrageOpportunity) => opportunity.velocityScore,
    };

    return [...opportunities].sort((a, b) => selectors[sort](b) - selectors[sort](a));
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
