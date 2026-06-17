import type {
  ArbitrageOpportunity,
  OpportunityFilters,
  OpportunityResponse,
  WorldPrice,
} from "@xiv-arbitrage/shared";
import { config } from "../config.js";
import pg from "pg";
import type { UniversalisMarketData } from "./universalis.js";
import { WorldCatalog } from "./worldCatalog.js";
import { XivApiClient } from "./xivapi.js";

const { Pool } = pg;

export class ArbitrageService {
  private db: pg.Pool | null = null;
  private worldCatalog: WorldCatalog;
  private xivapi: XivApiClient;

  constructor(worldCatalog?: WorldCatalog, xivapi?: XivApiClient) {
    this.worldCatalog = worldCatalog || new WorldCatalog();
    this.xivapi = xivapi || new XivApiClient();

    if (config.databaseUrl) {
      this.db = new Pool({
        connectionString: config.databaseUrl,
        ssl: config.databaseUrl.includes("localhost") ? false : { rejectUnauthorized: false },
      });
      this.db.on("error", (error) => {
        console.error(`ArbitrageService: Unexpected database pool error: ${error}`);
        // Don't crash the app; log and continue. The pool will attempt to reconnect.
      });
    }
  }

  async findOpportunities(filters: OpportunityFilters): Promise<OpportunityResponse> {
    const opportunities = await this.scanOpportunitiesFromDb();
    return this.createResponse(opportunities, filters, new Date().toISOString());
  }

  async scanOpportunitiesFromDb(): Promise<ArbitrageOpportunity[]> {
    if (!this.db) {
      // Fallback if database is not configured
      return [];
    }

    try {
      const worldById = await this.worldCatalog.getWorldById();

      // Get all items that have recent market data
      const result = await this.db.query<{ item_id: number; regions: string }>(
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

      const opportunities: (ArbitrageOpportunity | null)[] = await Promise.all(
        itemsToEvaluate.map(({ item_id: itemId, regions: regionsStr }) => {
          const regions =
            typeof regionsStr === "string" ? JSON.parse(regionsStr) : (regionsStr as string[]);
          return this.evaluateItemFromDb(itemId, regions, worldById);
        }),
      );

      return opportunities.filter((opp): opp is ArbitrageOpportunity => opp !== null);
    } catch (error) {
      console.error(`ArbitrageService: Error scanning opportunities from DB: ${error}`);
      return [];
    }
  }

  private async evaluateItemFromDb(
    itemId: number,
    regions: string[],
    worldById: Map<number, { name: string; dataCenter: string }>,
  ): Promise<ArbitrageOpportunity | null> {
    if (!this.db) return null;

    try {
      // Get recent market data for this item across all regions
      const result = await this.db.query<{ data: UniversalisMarketData; region: string }>(
        `
        SELECT data, region
        FROM market_snapshots
        WHERE item_id = $1
          AND region = ANY($2::text[])
          AND fetched_at > now() - interval '24 hours'
        ORDER BY fetched_at DESC
        LIMIT 100
        `,
        [itemId, regions],
      );

      if (result.rows.length === 0) {
        return null;
      }

      // Aggregate prices across all recent snapshots
      const allListingPrices = new Map<number, WorldPrice>();
      const allSoldPrices = new Map<number, WorldPrice>();
      let totalRecentSales = 0;
      let totalAveragePrice = 0;
      let dataPointCount = 0;

      for (const { data } of result.rows) {
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

      // Low side: cheapest listing price (what you pay to buy)
      // High side: highest sold price per world (actual transactions, not wishful listings)
      // Fall back to listing prices for the high side if no sales data is available
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
      const spread = high.pricePerUnit - low.pricePerUnit;

      if (spread <= 0) {
        return null;
      }

      const recentSales = totalRecentSales;
      const averageSalePrice =
        dataPointCount > 0 ? Math.round(totalAveragePrice / dataPointCount) : 0;
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
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`ArbitrageService: Error evaluating item ${itemId}: ${error}`);
      return null;
    }
  }

  createResponse(
    opportunities: ArbitrageOpportunity[],
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
        ...new Set(opportunities.map((opportunity) => opportunity.item.category).filter(isDefined)),
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

  /**
   * Extracts the highest sold price per world from recentHistory.
   * Using sold prices (actual transactions) rather than listing prices
   * (asking prices) for the high side of the spread filters out
   * unrealistic listings that will never sell.
   */
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
    opportunities: ArbitrageOpportunity[],
    filters: OpportunityFilters,
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
