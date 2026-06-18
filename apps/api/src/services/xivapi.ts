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
  LevelItem?: number;
  StackSize?: number;
}

export class XivApiClient {
  private readonly cache = new Map<number, ItemDetails>();

  async getItemDetails(itemId: number): Promise<ItemDetails> {
    const cached = this.cache.get(itemId);
    if (cached) {
      return cached;
    }

    const url = new URL(`${config.xivapiBaseUrl}/sheet/Item/${itemId}`);
    url.searchParams.set("fields", "Name,Description,Icon,ItemUICategory.Name,LevelItem,StackSize");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "xiv-arbitrage/0.1.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

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
      levelItem: row.fields.LevelItem,
      stackSize: row.fields.StackSize,
    };

    this.cache.set(itemId, item);
    return item;
  }
}
