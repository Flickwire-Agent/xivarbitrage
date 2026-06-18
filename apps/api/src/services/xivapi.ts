import type { ItemDetails } from "@xiv-arbitrage/shared";
import { config } from "../config.js";

interface XivApiRow<T> {
  row_id: number;
  fields: T;
}

interface XivApiItemFields {
  Name?: string;
  Description?: string;
  Icon?: {
    path?: string;
    path_hr1?: string;
  };
  ItemUICategory?: {
    fields?: {
      Name?: string;
    };
  };
  LevelItem?: number | { value?: number; row_id?: number };
  StackSize?: number | { value?: number };
}

function numericField(
  value: number | { value?: number; row_id?: number } | undefined,
): number | undefined {
  if (typeof value === "number") return value;
  return value?.value ?? value?.row_id;
}

export class XivApiClient {
  private static readonly cache = new Map<number, ItemDetails>();
  private static readonly inFlight = new Map<number, Promise<ItemDetails>>();

  async getItemDetails(itemId: number): Promise<ItemDetails> {
    const cached = XivApiClient.cache.get(itemId);
    if (cached) {
      return cached;
    }

    const pending = XivApiClient.inFlight.get(itemId);
    if (pending) {
      return pending;
    }

    const request = this.fetchItemDetails(itemId);
    XivApiClient.inFlight.set(itemId, request);

    try {
      return await request;
    } finally {
      XivApiClient.inFlight.delete(itemId);
    }
  }

  private async fetchItemDetails(itemId: number): Promise<ItemDetails> {
    const url = new URL(`${config.xivapiBaseUrl}/sheet/Item/${itemId}`);
    url.searchParams.set("fields", "Name,Description,Icon,ItemUICategory.Name,LevelItem,StackSize");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": "xiv-arbitrage/0.1.0",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`XIVAPI item request failed: ${response.status} ${response.statusText}`);
    }

    const row = (await response.json()) as XivApiRow<XivApiItemFields>;
    const iconPath = row.fields.Icon?.path_hr1 ?? row.fields.Icon?.path;
    const item: ItemDetails = {
      id: row.row_id,
      name: row.fields.Name ?? `Item ${itemId}`,
      description: row.fields.Description,
      iconUrl: iconPath
        ? `${config.xivapiBaseUrl}/asset?path=${encodeURIComponent(iconPath)}&format=png`
        : undefined,
      category: row.fields.ItemUICategory?.fields?.Name,
      levelItem: numericField(row.fields.LevelItem),
      stackSize: numericField(row.fields.StackSize),
    };

    XivApiClient.cache.set(itemId, item);
    if (XivApiClient.cache.size > 15000) {
      const keys = Array.from(XivApiClient.cache.keys());
      for (let i = 0; i < 7500; i++) XivApiClient.cache.delete(keys[i]!);
    }
    return item;
  }
}
