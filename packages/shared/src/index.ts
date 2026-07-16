export interface ItemDetails {
  id: number;
  name: string;
  description?: string;
  iconUrl?: string;
  category?: string;
  levelItem?: number;
  stackSize?: number;
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
  itemDetails?: Record<number, ItemDetails>;
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

export type MarketWarningCode =
  | "missing_listings"
  | "stale_snapshot"
  | "stale_average"
  | "low_sales"
  | "thin_price_history"
  | "limited_dc_coverage";

export type MarketWarningSeverity = "info" | "warning" | "critical";

export interface MarketWarning {
  code: MarketWarningCode;
  severity: MarketWarningSeverity;
  message: string;
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

export interface BargainsQuery {
  minAvgPrice?: number;
  minDiscount?: number;
  minDiscountPercent?: number;
  minQuantity?: number;
  dataCenter?: string;
  world?: string;
  sort?: "discount" | "discountPercent" | "price";
  page?: number;
  perPage?: number;
}

export interface BargainsResponse {
  generatedAt: string;
  bargains: BargainListing[];
  itemDetails?: Record<number, ItemDetails>;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ListingsResponse {
  itemId: number;
  itemDetails?: Record<number, ItemDetails>;
  listings: ItemListing[];
  warnings: MarketWarning[];
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
  warnings: MarketWarning[];
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
  itemDetails?: Record<number, ItemDetails>;
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}
