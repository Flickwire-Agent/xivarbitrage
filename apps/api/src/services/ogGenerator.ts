import type { ItemDetails } from "@xiv-arbitrage/shared";
import { xivapiProxy } from "./xivapiProxy.js";
import { dcDisparityCache } from "./dcDisparityCache.js";
import { bargainsCache } from "./bargainsCache.js";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;
const COLORS = {
  bg: "#0f1419",
  panel: "#1a2332",
  accent: "#e8a838",
  text: "#e1e8f0",
  muted: "#8899aa",
  border: "#2a3444",
  green: "#4ade80",
  red: "#f87171",
};

function fmtGil(n: number): string {
  return n.toLocaleString("en-GB");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchIconBase64(item: ItemDetails): Promise<string | null> {
  if (!item.iconUrl) return null;
  try {
    const res = await fetch(item.iconUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

function disparitiesSvg(
  items: {
    name: string;
    highDc: string;
    highPrice: number;
    lowDc: string;
    lowPrice: number;
    spread: number;
  }[],
  title: string,
): string {
  const rows = items
    .map((item, i) => {
      const y = 180 + i * 76;
      return `
      <g transform="translate(40, ${y})">
        <rect x="0" y="0" width="1120" height="64" rx="8" fill="${COLORS.panel}"/>
        <text x="24" y="38" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="700" fill="${COLORS.muted}">${i + 1}</text>
        <text x="56" y="38" font-family="Inter,system-ui,sans-serif" font-size="18" font-weight="600" fill="${COLORS.text}">${escapeXml(item.name)}</text>
        <text x="640" y="28" font-family="Inter,system-ui,sans-serif" font-size="13" fill="${COLORS.muted}" text-anchor="end">${escapeXml(item.highDc)}</text>
        <text x="640" y="50" font-family="Inter,system-ui,sans-serif" font-size="20" font-weight="700" fill="${COLORS.green}" text-anchor="end">${fmtGil(item.highPrice)}</text>
        <text x="680" y="38" font-family="Inter,system-ui,sans-serif" font-size="18" fill="${COLORS.muted}">→</text>
        <text x="760" y="28" font-family="Inter,system-ui,sans-serif" font-size="13" fill="${COLORS.muted}" text-anchor="start">${escapeXml(item.lowDc)}</text>
        <text x="760" y="50" font-family="Inter,system-ui,sans-serif" font-size="20" font-weight="700" fill="${COLORS.red}" text-anchor="start">${fmtGil(item.lowPrice)}</text>
        <rect x="960" y="12" width="140" height="40" rx="6" fill="${COLORS.accent}" opacity="0.15"/>
        <text x="1030" y="37" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="700" fill="${COLORS.accent}" text-anchor="middle">+${fmtGil(item.spread)}</text>
      </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COLORS.bg}"/>
      <stop offset="100%" stop-color="#161e2b"/>
    </linearGradient>
    <linearGradient id="headerLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${COLORS.accent}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${COLORS.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="200" height="4" fill="url(#headerLine)"/>
  <g transform="translate(40, 36)">
    <text font-family="Inter,system-ui,sans-serif" font-size="14" font-weight="700" fill="${COLORS.accent}" letter-spacing="3">XIV ARBITRAGE</text>
    <text x="0" y="24" font-family="Inter,system-ui,sans-serif" font-size="22" font-weight="700" fill="${COLORS.text}">${escapeXml(title)}</text>
    <text x="1080" y="-4" font-family="Inter,system-ui,sans-serif" font-size="12" fill="${COLORS.muted}" text-anchor="end">xivarbitrage.projects.blueskye.co.uk</text>
  </g>
  ${rows}
  <text x="600" y="${HEIGHT - 28}" font-family="Inter,system-ui,sans-serif" font-size="12" fill="${COLORS.muted}" text-anchor="middle">xivarbitrage.projects.blueskye.co.uk</text>
</svg>`;
}

function bargainsSvg(
  items: {
    name: string;
    world: string;
    dc: string;
    listingPrice: number;
    avgPrice: number;
    discountPercent: number;
  }[],
  title: string,
): string {
  const rows = items
    .map((item, i) => {
      const y = 180 + i * 76;
      return `
      <g transform="translate(40, ${y})">
        <rect x="0" y="0" width="1120" height="64" rx="8" fill="${COLORS.panel}"/>
        <text x="24" y="38" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="700" fill="${COLORS.muted}">${i + 1}</text>
        <text x="56" y="38" font-family="Inter,system-ui,sans-serif" font-size="18" font-weight="600" fill="${COLORS.text}">${escapeXml(item.name)}</text>
        <text x="600" y="28" font-family="Inter,system-ui,sans-serif" font-size="13" fill="${COLORS.muted}" text-anchor="end">${escapeXml(item.world)} (${escapeXml(item.dc)})</text>
        <text x="600" y="50" font-family="Inter,system-ui,sans-serif" font-size="20" font-weight="700" fill="${COLORS.red}" text-anchor="end">${fmtGil(item.listingPrice)}</text>
        <text x="620" y="38" font-family="Inter,system-ui,sans-serif" font-size="16" fill="${COLORS.muted}">avg ${fmtGil(item.avgPrice)}</text>
        <rect x="960" y="12" width="140" height="40" rx="6" fill="${COLORS.green}" opacity="0.15"/>
        <text x="1030" y="37" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="700" fill="${COLORS.green}" text-anchor="middle">-${item.discountPercent}%</text>
      </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COLORS.bg}"/>
      <stop offset="100%" stop-color="#161e2b"/>
    </linearGradient>
    <linearGradient id="headerLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${COLORS.green}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${COLORS.green}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="200" height="4" fill="url(#headerLine)"/>
  <g transform="translate(40, 36)">
    <text font-family="Inter,system-ui,sans-serif" font-size="14" font-weight="700" fill="${COLORS.accent}" letter-spacing="3">XIV ARBITRAGE</text>
    <text x="0" y="24" font-family="Inter,system-ui,sans-serif" font-size="22" font-weight="700" fill="${COLORS.text}">${escapeXml(title)}</text>
    <text x="1080" y="-4" font-family="Inter,system-ui,sans-serif" font-size="12" fill="${COLORS.muted}" text-anchor="end">xivarbitrage.projects.blueskye.co.uk</text>
  </g>
  ${rows}
  <text x="600" y="${HEIGHT - 28}" font-family="Inter,system-ui,sans-serif" font-size="12" fill="${COLORS.muted}" text-anchor="middle">xivarbitrage.projects.blueskye.co.uk</text>
</svg>`;
}

function itemSvg(
  name: string,
  category: string | undefined,
  iconBase64: string | null,
  stats: { label: string; value: string }[],
): string {
  const iconBlock = iconBase64
    ? `<image x="40" y="120" width="128" height="128" href="data:image/png;base64,${iconBase64}" />`
    : `<rect x="40" y="120" width="128" height="128" rx="16" fill="${COLORS.panel}"/><text x="104" y="200" font-family="Inter,system-ui,sans-serif" font-size="40" fill="${COLORS.muted}" text-anchor="middle">?</text>`;

  const statRows = stats
    .map((s, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 220 + col * 320;
      const y = 140 + row * 90;
      return `
      <g transform="translate(${x}, ${y})">
        <text font-family="Inter,system-ui,sans-serif" font-size="13" fill="${COLORS.muted}">${escapeXml(s.label)}</text>
        <text y="30" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" fill="${COLORS.text}">${escapeXml(s.value)}</text>
      </g>`;
    })
    .join("\n");

  const categoryStr = category ? escapeXml(category) : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COLORS.bg}"/>
      <stop offset="100%" stop-color="#161e2b"/>
    </linearGradient>
    <linearGradient id="headerLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${COLORS.accent}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${COLORS.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="200" height="4" fill="url(#headerLine)"/>
  <g transform="translate(40, 36)">
    <text font-family="Inter,system-ui,sans-serif" font-size="14" font-weight="700" fill="${COLORS.accent}" letter-spacing="3">XIV ARBITRAGE</text>
    <text x="0" y="24" font-family="Inter,system-ui,sans-serif" font-size="22" font-weight="700" fill="${COLORS.text}">${escapeXml(name)}</text>
    ${categoryStr ? `<text x="0" y="46" font-family="Inter,system-ui,sans-serif" font-size="14" fill="${COLORS.muted}">${categoryStr}</text>` : ""}
    <text x="1080" y="-4" font-family="Inter,system-ui,sans-serif" font-size="12" fill="${COLORS.muted}" text-anchor="end">xivarbitrage.projects.blueskye.co.uk</text>
  </g>
  ${iconBlock}
  ${statRows}
  <line x1="40" y1="290" x2="1160" y2="290" stroke="${COLORS.border}" stroke-width="1"/>
  <text x="600" y="${HEIGHT - 28}" font-family="Inter,system-ui,sans-serif" font-size="12" fill="${COLORS.muted}" text-anchor="middle">xivarbitrage.projects.blueskye.co.uk</text>
</svg>`;
}

const cache = new Map<string, { png: Buffer; createdAt: number }>();
const CACHE_TTL = 15 * 60 * 1000;

async function render(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function getCached(key: string, svg: string): Promise<Buffer> {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.createdAt < CACHE_TTL) {
    return entry.png;
  }
  const png = await render(svg);
  cache.set(key, { png, createdAt: Date.now() });
  if (cache.size > 100) {
    const entries = [...cache.entries()];
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [k] of entries.slice(0, 20)) cache.delete(k);
  }
  return png;
}

export async function generateDisparitiesOg(page: number): Promise<Buffer> {
  const key = `disparities:${page}`;
  const entry = cache.get(key);
  if (entry && Date.now() - entry.createdAt < CACHE_TTL) return entry.png;

  const allDisparities = await dcDisparityCache.get({ page, perPage: 5, sort: "spread" });
  const itemDetails = await xivapiProxy.getCachedItemDetails(
    allDisparities.disparities.map((d) => d.itemId),
  );

  const items = allDisparities.disparities
    .filter((d) => d.spread > 0)
    .slice(0, 5)
    .map((d) => ({
      name: itemDetails[d.itemId]?.name ?? `Item #${d.itemId}`,
      highDc: d.highDc.dataCenter,
      highPrice: d.highDc.avgPrice,
      lowDc: d.lowDc.dataCenter,
      lowPrice: d.lowDc.avgPrice,
      spread: d.spread,
    }));

  const title = items.length > 0 ? "Top Data Center Price Disparities" : "DC Price Disparities";

  return getCached(key, disparitiesSvg(items, title));
}

export async function generateBargainsOg(page: number): Promise<Buffer> {
  const key = `bargains:${page}`;
  const entry = cache.get(key);
  if (entry && Date.now() - entry.createdAt < CACHE_TTL) return entry.png;

  const { bargains } = await bargainsCache.get();
  const sorted = [...bargains].sort((a, b) => b.discountPercent - a.discountPercent);
  const top = sorted.slice((page - 1) * 5, page * 5);
  const itemDetails = await xivapiProxy.getCachedItemDetails(top.map((b) => b.itemId));

  const items = top.map((b) => ({
    name: itemDetails[b.itemId]?.name ?? `Item #${b.itemId}`,
    world: b.worldName,
    dc: b.dataCenter,
    listingPrice: b.pricePerUnit,
    avgPrice: b.recentAvgPrice,
    discountPercent: b.discountPercent,
  }));

  const title = items.length > 0 ? "Top Market Bargains" : "Market Bargains";

  return getCached(key, bargainsSvg(items, title));
}

export async function generateItemOg(itemId: number): Promise<Buffer> {
  const key = `item:${itemId}`;
  const entry = cache.get(key);
  if (entry && Date.now() - entry.createdAt < CACHE_TTL) return entry.png;

  const itemDetails = await xivapiProxy.getCachedItemDetails([itemId]);

  const item = itemDetails[itemId];
  if (!item) {
    const fallbackSvg = itemSvg(`Item #${itemId}`, undefined, null, []);
    return getCached(key, fallbackSvg);
  }

  const iconBase64 = await fetchIconBase64(item);

  const { marketSnapshotStore } = await import("./marketSnapshotStore.js");
  const sales = await marketSnapshotStore.getSaleHistory(itemId);
  const prices = sales.map((s) => s.pricePerUnit);
  const totalSales = prices.length;
  const avgPrice = totalSales > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / totalSales) : 0;
  const maxPrice = totalSales > 0 ? Math.max(...prices) : 0;
  const minPrice = totalSales > 0 ? Math.min(...prices) : 0;

  const stats: { label: string; value: string }[] = [];
  if (totalSales > 0) {
    stats.push({ label: "Average Price", value: `${fmtGil(avgPrice)}` });
    stats.push({ label: "Min Price", value: `${fmtGil(minPrice)}` });
    stats.push({ label: "Max Price", value: `${fmtGil(maxPrice)}` });
    stats.push({ label: "Total Sales (30d)", value: `${totalSales}` });
  }

  return getCached(key, itemSvg(item.name, item.category, iconBase64, stats));
}
