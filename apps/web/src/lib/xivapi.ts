const XIVAPI_ASSET_URL = "https://v2.xivapi.com/api";
const XIVAPI_PROXY_BASE_URL = "/api/xivapi";

export interface XivApiItemFields {
  Name?: string;
  Icon?: {
    path?: string;
    path_hr1?: string;
  };
  ItemUICategory?: {
    fields?: {
      Name?: string;
    };
  };
}

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

function buildIconUrl(iconPath: string | undefined): string | undefined {
  if (!iconPath) return undefined;
  return `${XIVAPI_ASSET_URL}/asset?path=${encodeURIComponent(iconPath)}&format=png`;
}

export async function fetchItemDetails(itemId: number): Promise<ItemDetails> {
  const url = new URL(`${XIVAPI_PROXY_BASE_URL}/sheet/Item/${itemId}`);
  url.searchParams.set("fields", "Name,Icon,ItemUICategory.Name");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`XIVAPI request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    row_id: number;
    fields: XivApiItemFields;
  };

  const iconPath = data.fields.Icon?.path ?? data.fields.Icon?.path_hr1;
  return {
    id: data.row_id,
    name: data.fields.Name ?? `Item ${itemId}`,
    iconUrl: buildIconUrl(iconPath),
    category: data.fields.ItemUICategory?.fields?.Name,
  };
}

export async function searchItems(query: string): Promise<ItemDetails[]> {
  const url = new URL(`${XIVAPI_PROXY_BASE_URL}/search`);
  const sanitized = query.replace(/["\\]/g, "").trim();
  url.searchParams.set("query", `Name~"${sanitized}"`);
  url.searchParams.set("sheets", "Item");
  url.searchParams.set("fields", "Name,Icon,ItemUICategory.Name");
  url.searchParams.set("limit", "20");

  const response = await fetch(url);
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
