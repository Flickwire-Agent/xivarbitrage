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
  grossSpread: number;
  grossSpreadPercent: number;
  spread: number;
  spreadPercent: number;
  netBuyPrice: number;
  netSellPrice: number;
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
  page?: number;
  perPage?: number;
}

export interface SaleRecord {
  worldId: number;
  worldName: string;
  pricePerUnit: number;
  quantity: number;
  soldAt: string;
}

export interface ItemHistoryResponse {
  itemId: number;
  item: ItemDetails;
  sales: SaleRecord[];
  worlds: string[];
  worldDataCenters: Record<number, string>;
}

export interface OpportunityResponse {
  generatedAt: string;
  filters: OpportunityFilters;
  opportunities: ArbitrageOpportunity[];
  worlds: string[];
  dataCenters: string[];
  categories: string[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
