export interface WorldPrice {
  worldId: number;
  worldName: string;
  dataCenter: string;
  pricePerUnit: number;
  quantity: number;
}

export interface ItemDetails {
  id: number;
  name: string;
  description?: string;
  iconUrl?: string;
  category?: string;
  levelItem?: number;
  stackSize?: number;
}

export interface ArbitrageOpportunity {
  itemId: number;
  item: ItemDetails;
  low: WorldPrice;
  high: WorldPrice;
  spread: number;
  spreadPercent: number;
  recentSales: number;
  averageSalePrice: number;
  velocityScore: number;
  profitScore: number;
  updatedAt: string;
}

export type OpportunitySort = "best" | "spread" | "spreadPercent" | "volume" | "velocity";

export interface OpportunityFilters {
  highWorld?: string;
  highDataCenter?: string;
  category?: string;
  profile?: "all" | "high-volume" | "high-arbitrage";
  minVolume?: number;
  minSpread?: number;
  sort?: OpportunitySort;
  limit?: number;
}

export interface OpportunityResponse {
  generatedAt: string;
  filters: OpportunityFilters;
  opportunities: ArbitrageOpportunity[];
  worlds: string[];
  dataCenters: string[];
  categories: string[];
}
