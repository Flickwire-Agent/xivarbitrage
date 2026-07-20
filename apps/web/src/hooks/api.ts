import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type {
  ItemHistoryResponse,
  ListingsResponse,
  BargainsQuery,
  BargainsResponse,
  DcDisparityResponse,
  DcDisparityQuery,
  FreshnessStatusResponse,
  WorldsResponse,
} from "@xiv-arbitrage/shared";
import {
  fetchItemDetailsBatch,
  searchItems,
  type BulkItemDetailsResponse,
  type ItemDetails,
} from "../lib/xivapi.js";

const STALE_TIME_API = 15 * 60 * 1000;
const STALE_TIME_XIVAPI = 60 * 60 * 1000;
const STALE_TIME_WORLDS = 7 * 24 * 60 * 60 * 1000;
const STALE_TIME_FRESHNESS = 30 * 1000;
const METADATA_RETRY_INTERVAL_MS = 1500;
const MAX_METADATA_FAILURES = 5;
const MAX_METADATA_PENDING_POLLS = 20;
let embeddedItemDetails: Record<number, ItemDetails> | undefined;

function readEmbeddedItemDetails(): Record<number, ItemDetails> {
  if (embeddedItemDetails) return embeddedItemDetails;
  if (typeof document === "undefined") return {};

  const script = document.getElementById("xiv-embedded-item-details");
  if (!script?.textContent) {
    embeddedItemDetails = {};
    return embeddedItemDetails;
  }

  try {
    embeddedItemDetails = JSON.parse(script.textContent) as Record<number, ItemDetails>;
  } catch {
    embeddedItemDetails = {};
  }

  return embeddedItemDetails;
}

export function getEmbeddedItemDetails(itemId: number | undefined): ItemDetails | undefined {
  if (!itemId) return undefined;
  return readEmbeddedItemDetails()[itemId];
}

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

export function useFreshnessStatus() {
  return useQuery({
    queryKey: ["freshness-status"],
    queryFn: async () => {
      const response = await fetch("/api/freshness");
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      return response.json() as Promise<FreshnessStatusResponse>;
    },
    staleTime: STALE_TIME_FRESHNESS,
    refetchInterval: STALE_TIME_FRESHNESS,
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

export function useBargains(query: BargainsQuery, page: number) {
  return useQuery({
    queryKey: ["bargains", query, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query.minAvgPrice) params.set("minAvgPrice", String(query.minAvgPrice));
      if (query.minDiscount) params.set("minDiscount", String(query.minDiscount));
      if (query.minDiscountPercent)
        params.set("minDiscountPercent", String(query.minDiscountPercent));
      if (query.minQuantity) params.set("minQuantity", String(query.minQuantity));
      if (query.dataCenter) params.set("dataCenter", query.dataCenter);
      if (query.world) params.set("world", query.world);
      if (query.sort) params.set("sort", query.sort);
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

export function useItemSearch(query: string) {
  const normalizedKey = query.trim().toLowerCase();
  return useQuery({
    queryKey: ["xivapi-search", normalizedKey],
    queryFn: ({ signal }) => searchItems(normalizedKey, signal),
    enabled: normalizedKey.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRetriedItemDetails(
  itemId: number | undefined,
  initialDetail: ItemDetails | undefined,
) {
  const embeddedDetail = getEmbeddedItemDetails(itemId);
  const initialDetails = useMemo(() => {
    const detail = initialDetail ?? embeddedDetail;
    return detail ? { [detail.id]: detail } : undefined;
  }, [embeddedDetail, initialDetail]);

  const details = useBulkItemDetails(itemId ? [itemId] : [], initialDetails);
  return itemId ? details.get(itemId) : undefined;
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
  const [pendingPollCount, setPendingPollCount] = useState(0);
  const [metadataFailureBlocked, setMetadataFailureBlocked] = useState(false);

  useEffect(() => {
    setMetadataFetchEnabled(false);
    setPendingPollCount(0);
    setMetadataFailureBlocked(false);

    if (deferredMissingIds.length === 0) return undefined;

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => setMetadataFetchEnabled(true), {
        timeout: 1200,
      });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = globalThis.setTimeout(() => setMetadataFetchEnabled(true), 250);
    return () => globalThis.clearTimeout(timeoutId);
  }, [deferredMissingIds]);

  const metadataBlocked = pendingPollCount >= MAX_METADATA_PENDING_POLLS;

  const batchResult = useQuery<BulkItemDetailsResponse>({
    queryKey: ["xivapi-items", deferredMissingIds] as const,
    queryFn: () => fetchItemDetailsBatch(deferredMissingIds),
    enabled:
      metadataFetchEnabled &&
      deferredMissingIds.length > 0 &&
      !metadataBlocked &&
      !metadataFailureBlocked,
    staleTime: STALE_TIME_XIVAPI,
    retry: (failureCount) => failureCount < MAX_METADATA_FAILURES,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.pendingItemIds.length ? METADATA_RETRY_INTERVAL_MS : false;
    },
  });

  const pendingItemIdsKey = batchResult.data?.pendingItemIds.join(",") ?? "";

  useEffect(() => {
    if (!pendingItemIdsKey) return;
    setPendingPollCount((count) => count + 1);
  }, [pendingItemIdsKey, batchResult.dataUpdatedAt]);

  useEffect(() => {
    if (batchResult.failureCount >= MAX_METADATA_FAILURES) {
      setMetadataFailureBlocked(true);
    }
  }, [batchResult.failureCount]);

  for (const detail of Object.values(batchResult.data?.itemDetails ?? {})) {
    detailsMap.set(detail.id, detail);
  }

  return detailsMap;
}
