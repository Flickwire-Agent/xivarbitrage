import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import type {
  OpportunityFilters,
  OpportunityResponse,
  ItemHistoryResponse,
  ListingsResponse,
  BargainsResponse,
  DcDisparityResponse,
  DcDisparityQuery,
  WorldsResponse,
} from "@xiv-arbitrage/shared";
import { fetchItemDetails, searchItems, type ItemDetails } from "../lib/xivapi.js";

const STALE_TIME_API = 15 * 60 * 1000;
const STALE_TIME_XIVAPI = 60 * 60 * 1000;
const STALE_TIME_WORLDS = 7 * 24 * 60 * 60 * 1000;

export function useWorlds() {
  return useQuery({
    queryKey: ["worlds"],
    queryFn: async () => {
      const response = await fetch("/api/worlds");
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return response.json() as Promise<WorldsResponse>;
    },
    staleTime: STALE_TIME_WORLDS,
  });
}

export function useOpportunities(filters: OpportunityFilters, page: number) {
  const queryKey = ["opportunities", filters, page];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== "" && value !== "all") {
          params.set(key, String(value));
        }
      }
      if (page > 1) params.set("page", String(page));
      const response = await fetch(`/api/opportunities?${params.toString()}`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return response.json() as Promise<OpportunityResponse>;
    },
    staleTime: STALE_TIME_API,
  });
}

export function useItemHistory(itemId: number | undefined) {
  return useQuery({
    queryKey: ["item-history", itemId],
    queryFn: async () => {
      if (!itemId) throw new Error("No item ID");
      const response = await fetch(`/api/items/${itemId}/history`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return response.json() as Promise<ItemHistoryResponse>;
    },
    enabled: !!itemId,
    staleTime: STALE_TIME_API,
  });
}

export function useItemListings(itemId: number | undefined) {
  return useQuery({
    queryKey: ["item-listings", itemId],
    queryFn: async () => {
      if (!itemId) throw new Error("No item ID");
      const response = await fetch(`/api/items/${itemId}/listings`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return response.json() as Promise<ListingsResponse>;
    },
    enabled: !!itemId,
    staleTime: STALE_TIME_API,
  });
}

export function useBargains(page: number) {
  return useQuery({
    queryKey: ["bargains", page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (page > 1) params.set("page", String(page));
      params.set("perPage", String(50));
      const response = await fetch(`/api/bargains?${params.toString()}`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return response.json() as Promise<BargainsResponse>;
    },
    staleTime: STALE_TIME_API,
  });
}

export function useDcDisparities(query: DcDisparityQuery, page: number) {
  const queryKey = ["dc-disparities", query, page];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.highDc) params.set("highDc", query.highDc);
      if (query.lowDc) params.set("lowDc", query.lowDc);
      if (query.region) params.set("region", query.region);
      if (query.sort) params.set("sort", query.sort);
      if (query.minSpread) params.set("minSpread", String(query.minSpread));
      if (page > 1) params.set("page", String(page));
      params.set("perPage", String(50));
      const response = await fetch(`/api/dc-disparities?${params.toString()}`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return response.json() as Promise<DcDisparityResponse>;
    },
    staleTime: STALE_TIME_API,
  });
}

export function useItemDetails(itemId: number | undefined) {
  return useQuery({
    queryKey: ["xivapi-item", itemId],
    queryFn: () => fetchItemDetails(itemId!),
    enabled: !!itemId,
    staleTime: STALE_TIME_XIVAPI,
  });
}

export function useItemSearch(query: string) {
  return useQuery({
    queryKey: ["xivapi-search", query],
    queryFn: () => searchItems(query),
    enabled: query.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePrefetchItemDetails() {
  const queryClient = useQueryClient();
  return (itemId: number) => {
    queryClient.prefetchQuery({
      queryKey: ["xivapi-item", itemId],
      queryFn: () => fetchItemDetails(itemId),
      staleTime: STALE_TIME_XIVAPI,
    });
  };
}

export function useInvalidateOpportunities() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
  };
}

export function useBulkItemDetails(itemIds: number[]) {
  const uniqueIds = [...new Set(itemIds)].filter(Boolean);
  const queries = uniqueIds.map((id) => ({
    queryKey: ["xivapi-item", id] as const,
    queryFn: () => fetchItemDetails(id),
    staleTime: STALE_TIME_XIVAPI,
  }));

  const results = useQueries({ queries });
  const detailsMap = new Map<number, ItemDetails>();
  results.forEach((result, i) => {
    if (result.data) {
      detailsMap.set(uniqueIds[i]!, result.data);
    }
  });
  return detailsMap;
}
