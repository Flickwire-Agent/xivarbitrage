const XIVAPI_ASSET_URL = "https://v2.xivapi.com/api";
const XIVAPI_PROXY_BASE_URL = "/api/xivapi";

export interface XivApiSearchResult {
  row_id: number;
  fields: {
    Name: string;
    Icon?: { path?: string; path_hr1?: string };
    ItemUICategory?: { fields?: { Name: string } };
  };
}

export interface ItemDetails {
  id: number;
  name: string;
  iconUrl?: string;
  category?: string;
}

export interface BulkItemDetailsResponse {
  itemDetails: Record<number, ItemDetails>;
  pendingItemIds: number[];
}

function buildIconUrl(iconPath: string | undefined): string | undefined {
  if (!iconPath) return undefined;
  return `${XIVAPI_ASSET_URL}/asset?path=${encodeURIComponent(iconPath)}&format=png`;
}

export async function fetchItemDetailsBatch(itemIds: number[]): Promise<BulkItemDetailsResponse> {
  const uniqueIds = [...new Set(itemIds)].filter(Boolean);
  if (uniqueIds.length === 0) return { itemDetails: {}, pendingItemIds: [] };

  const url = new URL(`${XIVAPI_PROXY_BASE_URL}/items`, window.location.origin);
  url.searchParams.set("ids", uniqueIds.join(","));
  url.searchParams.set("waitMs", "1800");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`XIVAPI batch request failed: ${response.status}`);
  }

  return response.json() as Promise<BulkItemDetailsResponse>;
}

export async function searchItems(query: string, signal?: AbortSignal): Promise<ItemDetails[]> {
  const url = new URL(`${XIVAPI_PROXY_BASE_URL}/search`);
  const sanitized = query.replace(/["\\]/g, "").trim();
  url.searchParams.set("query", `Name~"${sanitized}"`);
  url.searchParams.set("sheets", "Item");
  url.searchParams.set("fields", "Name,Icon,ItemUICategory.Name");
  url.searchParams.set("limit", "20");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`XIVAPI search failed: ${response.status}`);
  }

  const data = (await response.json()) as { results?: XivApiSearchResult[] };
  return (data.results ?? []).map((r) => {
    const iconPath = r.fields.Icon?.path ?? r.fields.Icon?.path_hr1;
    return {
      id: r.row_id,
      name: r.fields.Name ?? `Item ${r.row_id}`,
      iconUrl: buildIconUrl(iconPath),
      category: r.fields.ItemUICategory?.fields?.Name,
    };
  });
}
