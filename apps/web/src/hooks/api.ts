import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type {
  ItemHistoryResponse,
  ListingsResponse,
  BargainsResponse,
  DcDisparityResponse,
  DcDisparityQuery,
  WorldsResponse,
} from "@xiv-arbitrage/shared";
import {
  fetchItemDetails,
  fetchItemDetailsBatch,
  searchItems,
  type BulkItemDetailsResponse,
  type ItemDetails,
} from "../lib/xivapi.js";

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

export function useBulkItemDetails(
  itemIds: number[],
  initialDetails: Record<number, ItemDetails> | undefined = undefined,
) {
  const uniqueIds = [...new Set(itemIds)].filter(Boolean);
  const detailsMap = new Map<number, ItemDetails>();

  for (const detail of Object.values(initialDetails ?? {})) {
    detailsMap.set(detail.id, detail);
  }

  const missingIds = uniqueIds.filter((id) => !detailsMap.has(id));
  const missingIdsKey = missingIds.join(",");
  const deferredMissingIds = useMemo(() => missingIds, [missingIdsKey]);
  const [metadataFetchEnabled, setMetadataFetchEnabled] = useState(false);

  useEffect(() => {
    setMetadataFetchEnabled(false);

    if (deferredMissingIds.length === 0) return undefined;

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => setMetadataFetchEnabled(true), {
        timeout: 1200,
      });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(() => setMetadataFetchEnabled(true), 250);
    return () => window.clearTimeout(timeoutId);
  }, [deferredMissingIds]);

  const batchResult = useQuery<BulkItemDetailsResponse>({
    queryKey: ["xivapi-items", deferredMissingIds] as const,
    queryFn: () => fetchItemDetailsBatch(deferredMissingIds),
    enabled: metadataFetchEnabled && deferredMissingIds.length > 0,
    staleTime: STALE_TIME_XIVAPI,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.pendingItemIds.length ? 1000 : false;
    },
  });

  for (const detail of Object.values(batchResult.data?.itemDetails ?? {})) {
    detailsMap.set(detail.id, detail);
  }

  return detailsMap;
}
