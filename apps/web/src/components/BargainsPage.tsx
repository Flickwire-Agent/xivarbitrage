import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { Link, useSearchParams } from "wouter";
import { useBargains, useBulkItemDetails, useWorlds } from "../hooks/api.js";
import {
  getItemDetailHref,
  rememberSourceScroll,
  useRestoreSourceScroll,
} from "../lib/navigationContext.js";
import { useUiStore } from "../stores/uiStore.js";
import { SearchBox } from "./SearchBox.js";
import { SelectField } from "./SelectField.js";
import type { BargainListing } from "@xiv-arbitrage/shared";
import { useEffect, useMemo } from "react";

const PAGE_SIZE = 50;

export function BargainsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isDarkMode, toggleDarkMode } = useUiStore();

  useEffect(() => {
    document.title = "Market Bargains | XIV Arbitrage";
  }, []);

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const minAvgPrice = searchParams.get("minAvgPrice") ?? "";
  const minDiscount = searchParams.get("minDiscount") ?? "";
  const minDiscountPercent = searchParams.get("minDiscountPercent") ?? "";
  const minQuantity = searchParams.get("minQuantity") ?? "";
  const dataCenter = searchParams.get("dataCenter") ?? "";
  const world = searchParams.get("world") ?? "";
  const sort = searchParams.get("sort") ?? "";

  const query = useMemo(
    () => ({
      minAvgPrice: minAvgPrice ? Number(minAvgPrice) : undefined,
      minDiscount: minDiscount ? Number(minDiscount) : undefined,
      minDiscountPercent: minDiscountPercent ? Number(minDiscountPercent) : undefined,
      minQuantity: minQuantity ? Number(minQuantity) : undefined,
      dataCenter: dataCenter || undefined,
      world: world || undefined,
      sort: (sort || undefined) as "discount" | "discountPercent" | "price" | undefined,
      perPage: PAGE_SIZE,
    }),
    [dataCenter, minAvgPrice, minDiscount, minDiscountPercent, minQuantity, sort, world],
  );

  const { data, isLoading, error } = useBargains(query, page);
  const { data: worldsData } = useWorlds();

  useRestoreSourceScroll(Boolean(data));

  const itemIds = useMemo(() => data?.bargains.map((b) => b.itemId) ?? [], [data?.bargains]);
  const itemDetails = useBulkItemDetails(itemIds, data?.itemDetails);

  const bargains = useMemo(() => {
    if (!data) return [];
    return data.bargains.map((b) => ({
      ...b,
      item: itemDetails.get(b.itemId) ?? { id: b.itemId, name: "Unknown item" },
    }));
  }, [data, itemDetails]);

  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? 1;
  const summary = useMemo(() => {
    const topDcCounts = new Map<string, number>();
    const topWorldCounts = new Map<string, number>();
    let discountTotal = 0;
    let discountPercentTotal = 0;
    for (const bargain of bargains) {
      discountTotal += bargain.discount;
      discountPercentTotal += bargain.discountPercent;
      topDcCounts.set(bargain.dataCenter, (topDcCounts.get(bargain.dataCenter) ?? 0) + 1);
      topWorldCounts.set(bargain.worldName, (topWorldCounts.get(bargain.worldName) ?? 0) + 1);
    }
    const topEntry = (counts: Map<string, number>) =>
      [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return {
      avgDiscount: bargains.length > 0 ? Math.round(discountTotal / bargains.length) : 0,
      avgDiscountPercent:
        bargains.length > 0 ? Math.round(discountPercentTotal / bargains.length) : 0,
      topDc: topEntry(topDcCounts),
      topWorld: topEntry(topWorldCounts),
    };
  }, [bargains]);

  const worldOptions = useMemo(
    () =>
      [...(worldsData?.worlds ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((worldOption) => worldOption.name),
    [worldsData?.worlds],
  );
  const dcOptions = useMemo(
    () => [...(worldsData?.dataCenters ?? [])].sort(),
    [worldsData?.dataCenters],
  );
  const hasActiveFilters = Boolean(
    minAvgPrice || minDiscount || minDiscountPercent || minQuantity || dataCenter || world || sort,
  );

  useEffect(() => {
    if (!data || data.totalPages < 1 || page <= data.totalPages) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (data.totalPages <= 1) {
        next.delete("page");
      } else {
        next.set("page", String(data.totalPages));
      }
      return next;
    });
  }, [data, page, setSearchParams]);

  function updateFilter(key: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === "" || value === "all") {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      next.delete("page");
      return next;
    });
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams());
  }

  function goToPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p > 1) {
        next.set("page", String(p));
      } else {
        next.delete("page");
      }
      return next;
    });
  }

  function getPageNumbers(): (number | "ellipsis")[] {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("ellipsis");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  }

  return (
    <>
      <section className="topBar">
        <div>
          <p className="eyebrow">Best Deals</p>
          <h1>Market Bargains</h1>
        </div>
        <SearchBox />
        <div className="topBarActions">
          <button
            type="button"
            className="iconButton"
            onClick={toggleDarkMode}
            aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDarkMode ? (
              <Sun size={18} aria-hidden="true" />
            ) : (
              <Moon size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </section>

      {error ? (
        <div className="notice error" role="alert">
          {error instanceof Error ? error.message : "Failed to load bargains"}
        </div>
      ) : null}

      <section className="metricStrip" aria-label="Bargain summary">
        <article>
          <div>
            <span>Matching bargains</span>
            <strong>{data ? data.total.toLocaleString() : "Loading"}</strong>
          </div>
        </article>
        <article>
          <div>
            <span>Average discount on this page</span>
            <strong>{data ? `${summary.avgDiscount.toLocaleString()} gil` : "Loading"}</strong>
          </div>
        </article>
        <article>
          <div>
            <span>Average discount % on this page</span>
            <strong>{data ? `${summary.avgDiscountPercent}%` : "Loading"}</strong>
          </div>
        </article>
        <article>
          <div>
            <span>Top DC / world on this page</span>
            <strong>
              {data
                ? `${summary.topDc?.[0] ?? "None"} / ${summary.topWorld?.[0] ?? "None"}`
                : "Loading"}
            </strong>
          </div>
        </article>
      </section>

      <section className="toolbar" aria-label="Bargain filters">
        <SelectField
          label="Data center"
          value={dataCenter}
          options={dcOptions}
          onChange={(value) => updateFilter("dataCenter", value)}
        />
        <SelectField
          label="World"
          value={world}
          options={worldOptions}
          onChange={(value) => updateFilter("world", value)}
        />
        <div className="selectField">
          <label htmlFor="bargain-sort">Sort by</label>
          <select
            id="bargain-sort"
            value={sort}
            onChange={(event) => updateFilter("sort", event.target.value)}
          >
            <option value="">Discount %</option>
            <option value="discount">Discount amount</option>
            <option value="price">Global average price</option>
          </select>
        </div>
        <div className="selectField">
          <label htmlFor="min-avg-price">Min average price</label>
          <input
            id="min-avg-price"
            type="number"
            min={0}
            step={1000}
            placeholder="0"
            value={minAvgPrice}
            onChange={(event) => updateFilter("minAvgPrice", event.target.value)}
          />
        </div>
        <div className="selectField">
          <label htmlFor="min-discount">Min discount</label>
          <input
            id="min-discount"
            type="number"
            min={0}
            step={1000}
            placeholder="0"
            value={minDiscount}
            onChange={(event) => updateFilter("minDiscount", event.target.value)}
          />
        </div>
        <div className="selectField">
          <label htmlFor="min-discount-percent">Min discount %</label>
          <input
            id="min-discount-percent"
            type="number"
            min={0}
            max={100}
            step={1}
            placeholder="20"
            value={minDiscountPercent}
            onChange={(event) => updateFilter("minDiscountPercent", event.target.value)}
          />
        </div>
        <div className="selectField">
          <label htmlFor="min-quantity">Min quantity</label>
          <input
            id="min-quantity"
            type="number"
            min={1}
            step={1}
            placeholder="1"
            value={minQuantity}
            onChange={(event) => updateFilter("minQuantity", event.target.value)}
          />
        </div>
        <button
          type="button"
          className="iconButton"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
        >
          Clear filters
        </button>
      </section>

      {isLoading ? (
        <div className="notice contentLoading" role="status" aria-live="polite">
          Scanning market for bargains...
        </div>
      ) : data && bargains.length > 0 ? (
        <section className="marketResults" aria-label="Market bargains">
          <div className="marketCards" aria-label="Bargain cards">
            {bargains.map(
              (
                b: BargainListing & {
                  item: { id: number; name: string; iconUrl?: string; category?: string };
                },
                i: number,
              ) => (
                <article
                  className="marketCard"
                  key={`${b.itemId}-${b.worldId}-${b.pricePerUnit}-${i}`}
                >
                  <div className="marketCardHeader">
                    <div className="itemCell">
                      {b.item.iconUrl ? (
                        <img src={b.item.iconUrl} alt="" width="42" height="42" loading="lazy" />
                      ) : (
                        <span className="itemIconPlaceholder" aria-hidden="true" />
                      )}
                      <div>
                        <h2>{b.item.name}</h2>
                        <span className="cellSubtext">{b.item.category ?? "Uncategorized"}</span>
                      </div>
                    </div>
                    <Link
                      href={getItemDetailHref(`/items/${b.itemId}/listings`)}
                      className="marketCardAction"
                      onClick={rememberSourceScroll}
                    >
                      View listings
                    </Link>
                  </div>
                  <dl className="marketCardStats">
                    <div>
                      <dt>World / DC</dt>
                      <dd>
                        <strong>{b.worldName}</strong>
                        <span>{b.dataCenter}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Listed price</dt>
                      <dd>
                        <strong>{b.pricePerUnit.toLocaleString()} gil</strong>
                        <span>Quantity {b.quantity.toLocaleString()}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Global average</dt>
                      <dd>
                        <strong>{b.recentAvgPrice.toLocaleString()} gil</strong>
                        <span>Recent IQR average</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Discount</dt>
                      <dd>
                        <strong className="discountPositive">
                          {b.discount.toLocaleString()} gil
                        </strong>
                        <span>{b.discountPercent}% below avg</span>
                      </dd>
                    </div>
                  </dl>
                </article>
              ),
            )}
          </div>
          <div className="tableShell" aria-label="Bargains table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Server</th>
                  <th scope="col">Data Center</th>
                  <th scope="col">Listed price</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Global avg</th>
                  <th scope="col">Discount</th>
                </tr>
              </thead>
              <tbody>
                {bargains.map(
                  (
                    b: BargainListing & {
                      item: { id: number; name: string; iconUrl?: string; category?: string };
                    },
                    i: number,
                  ) => (
                    <tr key={`${b.itemId}-${b.worldId}-${b.pricePerUnit}-${i}`}>
                      <td>
                        <div className="itemCell">
                          {b.item.iconUrl ? (
                            <img
                              src={b.item.iconUrl}
                              alt=""
                              width="42"
                              height="42"
                              loading="lazy"
                            />
                          ) : (
                            <span className="itemIconPlaceholder" aria-hidden="true" />
                          )}
                          <div>
                            <Link
                              href={getItemDetailHref(`/items/${b.itemId}/listings`)}
                              className="itemNameButton"
                              onClick={rememberSourceScroll}
                              aria-label={`View listings for ${b.item.name}`}
                            >
                              <strong>{b.item.name}</strong>
                            </Link>
                            <span className="cellSubtext">
                              {b.item.category ?? "Uncategorized"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{b.worldName}</strong>
                      </td>
                      <td>{b.dataCenter}</td>
                      <td>
                        <strong>{b.pricePerUnit.toLocaleString()} gil</strong>
                      </td>
                      <td>{b.quantity.toLocaleString()}</td>
                      <td>{b.recentAvgPrice.toLocaleString()} gil</td>
                      <td>
                        <div className="discountCell">
                          <strong className="discountPositive">
                            {b.discount.toLocaleString()} gil
                          </strong>
                          <span className="discountPct">{b.discountPercent}% below avg</span>
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <p className="tableFooter">
            Page {data.page} of {data.totalPages} &mdash; {data.total} total bargains &middot;
            Refreshed {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
          {data.totalPages > 1 ? (
            <nav className="pagination" aria-label="Pagination">
              <button
                type="button"
                className="iconButton"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} aria-hidden="true" />
                <span>Prev</span>
              </button>
              <div className="paginationPages">
                {getPageNumbers().map((p, i) =>
                  p === "ellipsis" ? (
                    <span key={`e${i}`} className="paginationEllipsis">
                      &hellip;
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      className={`paginationPage${p === page ? " active" : ""}`}
                      onClick={() => goToPage(p)}
                      aria-label={`Page ${p}`}
                      aria-current={p === page ? "page" : undefined}
                    >
                      {p}
                    </button>
                  ),
                )}
              </div>
              <button
                type="button"
                className="iconButton"
                disabled={page >= totalPages}
                onClick={() => goToPage(page + 1)}
                aria-label="Next page"
              >
                <span>Next</span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </nav>
          ) : null}
        </section>
      ) : data ? (
        <div className="notice">
          No bargains match these filters. Try lowering the price, discount, or quantity minimums.
          {hasActiveFilters ? (
            <button type="button" className="inlineAction" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
