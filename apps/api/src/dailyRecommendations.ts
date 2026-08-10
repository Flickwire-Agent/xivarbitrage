import { pathToFileURL } from "node:url";
import type { ItemDetails } from "@xiv-arbitrage/shared";
import pool from "./db/pool.js";
import type { UniversalisListing, UniversalisMarketData } from "./services/universalis.js";
import { xivapiProxy } from "./services/xivapiProxy.js";

const SPRIGGAN_WORLD_ID = 85;
const TRAVEL_WORLD_IDS = new Set([
  21,
  22,
  86,
  87,
  88, // Materia
  33,
  36,
  42,
  56,
  66,
  67,
  402,
  403, // Light
  39,
  71,
  80,
  83,
  85,
  97,
  400,
  401, // Chaos
]);
const MARKET_REGIONS = ["Europe", "Oceania"];
const SALES_WINDOW_DAYS = 7;
const MARKET_TAX_RATE = 0.05;
const CANDIDATE_LIMIT = 400;
const CRAFTING_SEARCH_LIMIT = 200;
const RECOMMENDATION_LIMIT = 5;

interface MarketCandidateRow {
  item_id: number;
  sale_count: number;
  units_sold: number;
  median_price: number;
}

interface SnapshotRow {
  item_id: number;
  data: UniversalisMarketData;
  fetched_at: Date;
}

interface Candidate {
  itemId: number;
  saleCount: number;
  unitsSold: number;
  medianPrice: number;
  details?: ItemDetails;
  snapshot?: SnapshotRow;
}

interface XivApiSearchResult {
  row_id?: number;
  fields?: Record<string, unknown>;
}

interface XivApiSearchResponse {
  results?: XivApiSearchResult[];
}

interface Recipe {
  resultAmount: number;
  ingredients: { itemId: number; amount: number }[];
}

interface PurchaseRecommendation {
  candidate: Candidate;
  source: UniversalisListing;
  quantity: number;
  targetPrice: number;
  profit: number;
  margin: number;
}

interface GatheringRecommendation {
  candidate: Candidate;
  targetQuantity: number;
  targetPrice: number;
  method: string;
  score: number;
}

interface CraftRecommendation {
  candidate: Candidate;
  batches: number;
  resultAmount: number;
  ingredientCost: number;
  targetPrice: number;
  profit: number;
  margin: number;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function relationId(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const relation = value as { value?: unknown; row_id?: unknown };
  return asNumber(relation.value ?? relation.row_id);
}

function freshSnapshot(snapshot: SnapshotRow | undefined): snapshot is SnapshotRow {
  return Boolean(snapshot && Date.now() - snapshot.fetched_at.getTime() <= 8 * 60 * 60 * 1000);
}

function validListings(candidate: Candidate): UniversalisListing[] {
  if (!freshSnapshot(candidate.snapshot)) return [];
  return (candidate.snapshot.data.listings ?? []).filter(
    (listing) => listing.pricePerUnit > 0 && listing.quantity > 0 && listing.worldID,
  );
}

function mergeSnapshots(rows: SnapshotRow[]): Map<number, SnapshotRow> {
  const grouped = new Map<number, SnapshotRow[]>();
  for (const row of rows) {
    if (!freshSnapshot(row)) continue;
    const snapshots = grouped.get(row.item_id) ?? [];
    snapshots.push(row);
    grouped.set(row.item_id, snapshots);
  }

  return new Map(
    [...grouped].map(([itemId, snapshots]) => [
      itemId,
      {
        item_id: itemId,
        data: {
          itemID: itemId,
          listings: snapshots.flatMap((snapshot) => snapshot.data.listings ?? []),
        },
        fetched_at: new Date(
          Math.max(...snapshots.map((snapshot) => snapshot.fetched_at.getTime())),
        ),
      },
    ]),
  );
}

function lowestListing(
  listings: UniversalisListing[],
  predicate: (listing: UniversalisListing) => boolean = () => true,
): UniversalisListing | undefined {
  return listings
    .filter(predicate)
    .sort((left, right) => left.pricePerUnit - right.pricePerUnit)[0];
}

function realisticSprigganPrice(candidate: Candidate): number {
  const localListing = lowestListing(
    validListings(candidate),
    (listing) => listing.worldID === SPRIGGAN_WORLD_ID,
  );
  return Math.floor(Math.min(candidate.medianPrice, localListing?.pricePerUnit ?? Infinity));
}

function itemName(candidate: Candidate): string {
  return candidate.details?.name ?? `Item #${candidate.itemId}`;
}

function gil(value: number): string {
  return `${Math.round(value).toLocaleString("en-GB")} gil`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function loadCandidates(): Promise<Candidate[]> {
  const result = await pool.query<MarketCandidateRow>(
    `SELECT item_id,
            count(*)::int AS sale_count,
            sum(quantity)::int AS units_sold,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_unit)::int AS median_price
       FROM sale_history
      WHERE world_id = $1
        AND sold_at > now() - interval '7 days'
      GROUP BY item_id
     HAVING count(*) >= 3
      ORDER BY sum(quantity * price_per_unit) DESC
      LIMIT $2`,
    [SPRIGGAN_WORLD_ID, CANDIDATE_LIMIT],
  );

  const itemIds = result.rows.map((row) => row.item_id);
  const [snapshotResult, details] = await Promise.all([
    pool.query<SnapshotRow>(
      `SELECT item_id, data, fetched_at
         FROM market_snapshots
        WHERE region = ANY($2)
          AND item_id = ANY($1)`,
      [itemIds, MARKET_REGIONS],
    ),
    xivapiProxy.fetchItemDetailsBatch(itemIds, 15_000),
  ]);
  const snapshots = mergeSnapshots(snapshotResult.rows);

  return result.rows.map((row) => ({
    itemId: row.item_id,
    saleCount: row.sale_count,
    unitsSold: row.units_sold,
    medianPrice: row.median_price,
    details: details.itemDetails[row.item_id],
    snapshot: snapshots.get(row.item_id),
  }));
}

function buildPurchases(candidates: Candidate[]): PurchaseRecommendation[] {
  return candidates
    .flatMap((candidate): PurchaseRecommendation[] => {
      if (candidate.saleCount < 5) return [];
      const listings = validListings(candidate);
      const source = lowestListing(
        listings,
        (listing) =>
          listing.worldID !== SPRIGGAN_WORLD_ID && TRAVEL_WORLD_IDS.has(listing.worldID ?? 0),
      );
      const targetPrice = realisticSprigganPrice(candidate);
      if (!source || !targetPrice) return [];

      const dailyDemand = candidate.unitsSold / SALES_WINDOW_DAYS;
      const maximumStock = Math.max(1, Math.ceil(dailyDemand * 2));
      if (source.quantity > maximumStock || source.quantity > 99) return [];

      const netPerUnit = targetPrice * (1 - MARKET_TAX_RATE);
      const profitPerUnit = netPerUnit - source.pricePerUnit;
      const margin = profitPerUnit / source.pricePerUnit;
      const profit = profitPerUnit * source.quantity;
      if (margin < 0.12 || profit < 2_000 || source.pricePerUnit * source.quantity > 500_000) {
        return [];
      }

      return [{ candidate, source, quantity: source.quantity, targetPrice, profit, margin }];
    })
    .sort(
      (left, right) =>
        right.profit * Math.min(right.candidate.saleCount, 20) -
        left.profit * Math.min(left.candidate.saleCount, 20),
    )
    .slice(0, RECOMMENDATION_LIMIT);
}

async function searchSheet(
  sheet: "GatheringItem" | "Recipe",
  itemId: number,
): Promise<XivApiSearchResult[]> {
  const params = new URLSearchParams({ sheets: sheet, limit: "20" });
  if (sheet === "GatheringItem") {
    params.set("query", `+Item=${itemId}`);
    params.set("fields", "Item.Name,GatheringItemLevel.GatheringItemLevel");
  } else {
    params.set("query", `+ItemResult=${itemId}`);
    params.set("fields", "ItemResult.Name,AmountResult,Ingredient[].Name,AmountIngredient");
  }
  try {
    const response = (await xivapiProxy.fetchSearch(params)) as XivApiSearchResponse;
    return response.results ?? [];
  } catch (error) {
    console.warn(
      `[DailyRecommendations] ${sheet} lookup failed for item ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

async function buildGathering(candidates: Candidate[]): Promise<GatheringRecommendation[]> {
  const searchedCandidates = candidates.slice(0, CANDIDATE_LIMIT);
  const results = await Promise.all(
    searchedCandidates.map(async (candidate) => ({
      candidate,
      gatheringRows: await searchSheet("GatheringItem", candidate.itemId),
    })),
  );

  return results
    .flatMap(({ candidate, gatheringRows }): GatheringRecommendation[] => {
      const isAethersand = itemName(candidate).toLowerCase().endsWith("aethersand");
      const isTreasureMap = itemName(candidate).toLowerCase().startsWith("timeworn ");
      const isTopsoil = itemName(candidate).toLowerCase().endsWith("topsoil");
      if (gatheringRows.length === 0 && !isAethersand) return [];
      const targetPrice = realisticSprigganPrice(candidate);
      if (targetPrice < 100) return [];
      const dailyUnits = candidate.unitsSold / SALES_WINDOW_DAYS;
      const targetQuantity = isTreasureMap
        ? 1
        : Math.min(isTopsoil ? 8 : isAethersand ? 30 : 50, Math.max(1, Math.ceil(dailyUnits)));
      const score = targetPrice * (1 - MARKET_TAX_RATE) * Math.min(targetQuantity, 20);
      return [
        {
          candidate,
          targetQuantity,
          targetPrice,
          method: isAethersand
            ? "collectable reduction"
            : isTreasureMap
              ? "the daily treasure-map allowance"
              : "gathering node",
          score,
        },
      ];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, RECOMMENDATION_LIMIT);
}

function parseRecipes(results: XivApiSearchResult[]): Recipe[] {
  return results.flatMap((result): Recipe[] => {
    const fields = result.fields;
    if (!fields) return [];
    const ingredients = Array.isArray(fields.Ingredient) ? fields.Ingredient : [];
    const amounts = Array.isArray(fields.AmountIngredient) ? fields.AmountIngredient : [];
    const parsedIngredients = ingredients
      .map((ingredient, index) => ({
        itemId: relationId(ingredient),
        amount: asNumber(amounts[index]),
      }))
      .filter((ingredient) => ingredient.itemId > 0 && ingredient.amount > 0);
    if (parsedIngredients.length === 0) return [];
    return [
      {
        resultAmount: Math.max(1, asNumber(fields.AmountResult, 1)),
        ingredients: parsedIngredients,
      },
    ];
  });
}

async function buildCrafting(candidates: Candidate[]): Promise<CraftRecommendation[]> {
  const searchedCandidates = candidates.slice(0, CRAFTING_SEARCH_LIMIT);
  const recipeResults = await Promise.all(
    searchedCandidates.map(async (candidate) => ({
      candidate,
      recipes: parseRecipes(await searchSheet("Recipe", candidate.itemId)),
    })),
  );
  const ingredientIds = [
    ...new Set(
      recipeResults.flatMap(({ recipes }) =>
        recipes.flatMap((recipe) => recipe.ingredients.map((ingredient) => ingredient.itemId)),
      ),
    ),
  ];
  const snapshotResult = await pool.query<SnapshotRow>(
    `SELECT item_id, data, fetched_at
       FROM market_snapshots
      WHERE region = ANY($2)
        AND item_id = ANY($1)`,
    [ingredientIds, MARKET_REGIONS],
  );
  const ingredientSnapshots = mergeSnapshots(snapshotResult.rows);

  return recipeResults
    .flatMap(({ candidate, recipes }): CraftRecommendation[] => {
      const targetPrice = realisticSprigganPrice(candidate);
      if (!targetPrice || candidate.saleCount < 3) return [];
      const recommendations = recipes.flatMap((recipe): CraftRecommendation[] => {
        let ingredientCost = 0;
        for (const ingredient of recipe.ingredients) {
          const snapshot = ingredientSnapshots.get(ingredient.itemId);
          if (!freshSnapshot(snapshot)) return [];
          const listing = lowestListing(
            snapshot.data.listings ?? [],
            (entry) =>
              entry.pricePerUnit > 0 &&
              entry.quantity >= ingredient.amount &&
              TRAVEL_WORLD_IDS.has(entry.worldID ?? 0),
          );
          if (!listing) return [];
          ingredientCost += listing.pricePerUnit * ingredient.amount;
        }
        if (ingredientCost <= 0) return [];

        const revenue = targetPrice * recipe.resultAmount * (1 - MARKET_TAX_RATE);
        const profit = revenue - ingredientCost;
        const margin = profit / ingredientCost;
        if (margin < 0.15 || profit < 2_000) return [];
        const dailySales = candidate.saleCount / SALES_WINDOW_DAYS;
        const batches = Math.min(
          20,
          Math.max(1, Math.floor(500_000 / ingredientCost)),
          Math.max(1, Math.ceil((dailySales * 2) / recipe.resultAmount)),
        );
        return [
          {
            candidate,
            batches,
            resultAmount: recipe.resultAmount,
            ingredientCost,
            targetPrice,
            profit,
            margin,
          },
        ];
      });
      return recommendations.sort((left, right) => right.profit - left.profit).slice(0, 1);
    })
    .sort(
      (left, right) =>
        right.profit * Math.min(right.candidate.saleCount, 20) -
        left.profit * Math.min(left.candidate.saleCount, 20),
    )
    .slice(0, RECOMMENDATION_LIMIT);
}

function reportDate(): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date());
}

function reportSection(title: string, lines: string[]): string[] {
  return [
    `## ${title}`,
    "",
    ...(lines.length > 0 ? lines : ["No candidates passed today's safety thresholds."]),
    "",
  ];
}

export async function generateDailyRecommendations(): Promise<string> {
  const candidates = await loadCandidates();
  const purchases = buildPurchases(candidates);
  const [gathering, crafting] = await Promise.all([
    buildGathering(candidates),
    buildCrafting(candidates),
  ]);
  const newestSnapshot = candidates
    .map((candidate) => candidate.snapshot?.fetched_at.getTime() ?? 0)
    .reduce((newest, value) => Math.max(newest, value), 0);

  const purchaseLines = purchases.map(
    ({ candidate, source, quantity, targetPrice, profit, margin }) =>
      `- Buy ${quantity} x ${itemName(candidate)} on ${source.worldName ?? `world ${source.worldID}`} at ${gil(source.pricePerUnit)}/unit. List on Spriggan near ${gil(targetPrice)}/unit. Estimated after-tax profit: ${gil(profit)} (${percent(margin)} return); ${candidate.saleCount} Spriggan sales in seven days.`,
  );
  const gatheringLines = gathering.map(
    ({ candidate, targetQuantity, targetPrice, method }) =>
      `- Gather ${targetQuantity} x ${itemName(candidate)} by ${method}. Spriggan's seven-day median is ${gil(targetPrice)}/unit from ${candidate.saleCount} sales (${candidate.unitsSold} units).`,
  );
  const craftingLines = crafting.map(
    ({ candidate, batches, resultAmount, ingredientCost, targetPrice, profit, margin }) =>
      `- Craft ${batches} batch${batches === 1 ? "" : "es"} of ${itemName(candidate)} (${resultAmount} per batch). Cheapest current inputs across Chaos, Light, and Materia cost about ${gil(ingredientCost)}/batch; list near ${gil(targetPrice)}/unit. Estimated after-tax profit: ${gil(profit)}/batch (${percent(margin)} return); ${candidate.saleCount} Spriggan sales in seven days.`,
  );

  return [
    "# Daily Spriggan Market Plan",
    "",
    `Generated ${reportDate()} from Spriggan sales and Chaos, Light, and Materia listings.`,
    newestSnapshot
      ? `Newest market snapshot used: ${new Date(newestSnapshot).toISOString()}.`
      : "No fresh market snapshot was available.",
    "",
    ...reportSection("Gather", gatheringLines),
    ...reportSection("Craft", craftingLines),
    ...reportSection("Purchase", purchaseLines),
    "## Guardrails",
    "",
    "- Verify each listing in-game before acting because Universalis data can change after upload.",
    "- Quantities are capped near two days of observed Spriggan demand.",
    "- Profit estimates include the 5% seller tax but not teleport fees or the value of your time.",
    "- Skip an item if its current price or stack size differs materially from this report.",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  try {
    process.stdout.write(await generateDailyRecommendations());
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
