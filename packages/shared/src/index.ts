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
  sales: SaleRecord[];
  worlds: string[];
}

export interface WorldInfo {
  id: number;
  name: string;
  dataCenter: string;
  region: string;
}

export interface WorldsResponse {
  worlds: WorldInfo[];
  dataCenters: string[];
  regions: string[];
  worldIdToDc: Record<number, string>;
  updatedAt: string;
}

export interface ItemListing {
  worldId: number;
  worldName: string;
  dataCenter: string;
  pricePerUnit: number;
  quantity: number;
  recentAvgPrice: number;
  discount: number;
  discountPercent: number;
}

export interface BargainListing {
  itemId: number;
  worldId: number;
  worldName: string;
  dataCenter: string;
  pricePerUnit: number;
  quantity: number;
  recentAvgPrice: number;
  discount: number;
  discountPercent: number;
}

export interface BargainsResponse {
  generatedAt: string;
  bargains: BargainListing[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ListingsResponse {
  itemId: number;
  listings: ItemListing[];
  saleStats: {
    avgPrice: number;
    count: number;
    perDataCenter: Record<string, { avgPrice: number; count: number }>;
  } | null;
}

export interface DcPriceInfo {
  dataCenter: string;
  region: string;
  avgPrice: number;
  saleCount: number;
}

export interface DcDisparity {
  itemId: number;
  spread: number;
  spreadPercent: number;
  highDc: DcPriceInfo;
  lowDc: DcPriceInfo;
  allDcs: DcPriceInfo[];
}

export interface DcDisparityQuery {
  highDc?: string;
  lowDc?: string;
  minSpread?: number;
  minSpreadPercent?: number;
  region?: string;
  sort?: "spread" | "spreadPercent";
  page?: number;
  perPage?: number;
}

export interface DcDisparityResponse {
  generatedAt: string;
  disparities: DcDisparity[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
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
