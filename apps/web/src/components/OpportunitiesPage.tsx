import type { OpportunityFilters } from "@xiv-arbitrage/shared";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Gauge,
  Moon,
  RefreshCw,
  Sun,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "wouter";
import { useInvalidateOpportunities, useOpportunities, useBulkItemDetails } from "../hooks/api.js";
import { useUiStore } from "../stores/uiStore.js";
import { OpportunityTable } from "./OpportunityTable.js";
import { SearchBox } from "./SearchBox.js";
import { SelectField } from "./SelectField.js";

const DEFAULT_PAGE_SIZE = 50;
const INITIAL_ITEM_DETAIL_COUNT = 12;
const FULL_ITEM_DETAIL_DELAY_MS = 10_000;

export function OpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isDarkMode, toggleDarkMode } = useUiStore();
  const invalidateOpportunities = useInvalidateOpportunities();
  const [itemDetailLimit, setItemDetailLimit] = useState(0);

  useEffect(() => {
    document.title = "XIV Arbitrage — FFXIV Market Board Arbitrage Finder";
  }, []);

  const filters: OpportunityFilters = useMemo(
    () => ({
      profile: (searchParams.get("profile") as OpportunityFilters["profile"]) ?? "all",
      sort: (searchParams.get("sort") as OpportunityFilters["sort"]) ?? "best",
      highWorld: searchParams.get("highWorld") ?? undefined,
      highDataCenter: searchParams.get("highDataCenter") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      minVolume: searchParams.get("minVolume") ? Number(searchParams.get("minVolume")) : undefined,
      perPage: DEFAULT_PAGE_SIZE,
    }),
    [searchParams],
  );

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const { data, isLoading, error } = useOpportunities(filters, page);

  const itemIds = useMemo(
    () => data?.opportunities.map((o) => o.itemId) ?? [],
    [data?.opportunities],
  );
  const visibleItemIds = useMemo(
    () => itemIds.slice(0, itemDetailLimit),
    [itemDetailLimit, itemIds],
  );
  const itemDetails = useBulkItemDetails(visibleItemIds);

  useEffect(() => {
    if (itemIds.length === 0) return;

    const windowWithIdle = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const firstBatchCount = Math.min(INITIAL_ITEM_DETAIL_COUNT, itemIds.length);
    const fallback = window.setTimeout(() => setItemDetailLimit(firstBatchCount), 2500);
    const idleHandle = windowWithIdle.requestIdleCallback?.(
      () => {
        window.clearTimeout(fallback);
        setItemDetailLimit(firstBatchCount);
      },
      { timeout: 2500 },
    );
    const fullBatch = window.setTimeout(() => {
      setItemDetailLimit(itemIds.length);
    }, FULL_ITEM_DETAIL_DELAY_MS);

    return () => {
      window.clearTimeout(fallback);
      window.clearTimeout(fullBatch);
      if (idleHandle !== undefined) windowWithIdle.cancelIdleCallback?.(idleHandle);
    };
  }, [itemIds.length]);

  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? 1;

  const opportunities = useMemo(() => {
    if (!data) return [];
    return data.opportunities.map((o) => ({
      ...o,
      item: itemDetails.get(o.itemId) ?? { id: o.itemId, name: `Item ${o.itemId}` },
    }));
  }, [data, itemDetails]);

  const summary = useMemo(() => {
    if (!data) return { best: null, count: 0, totalVolume: 0 };
    const best = opportunities[0];
    const totalVolume = data.opportunities.reduce((sum, o) => sum + o.recentSales, 0);
    return { best, count: data.total, totalVolume };
  }, [data, opportunities]);

  function updateFilter<K extends keyof OpportunityFilters>(key: K, value: OpportunityFilters[K]) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === undefined || value === "" || value === "all") {
        next.delete(key as string);
      } else {
        next.set(key as string, String(value));
      }
      next.delete("page");
      return next;
    });
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
          <p className="eyebrow">Final Fantasy XIV Market Board</p>
          <h1>XIV Arbitrage</h1>
        </div>
        <SearchBox />
        <div className="topBarActions">
          <Link href="/bargains" className="iconButton" aria-label="View bargains">
            <TrendingUp size={16} aria-hidden="true" />
            <span>Bargains</span>
          </Link>
          <Link
            href="/dc-disparities"
            className="iconButton"
            aria-label="View data center price disparities"
          >
            <TrendingUp size={16} aria-hidden="true" />
            <span>DC Gaps</span>
          </Link>
          <a
            href="https://github.com/Flickwire-Agent/xivarbitrage"
            target="_blank"
            rel="noopener noreferrer"
            className="iconButton"
            aria-label="View source on GitHub"
          >
            <ExternalLink size={18} aria-hidden="true" />
            <span>GitHub</span>
          </a>
          <button
            className="iconButton"
            type="button"
            onClick={() => invalidateOpportunities()}
            aria-label="Refresh arbitrage opportunities"
          >
            <RefreshCw size={18} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            className="iconButton"
            type="button"
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

      <section className="metricStrip" aria-label="Market summary">
        <article>
          <TrendingUp size={18} aria-hidden="true" />
          <div>
            <span>Best spread</span>
            <strong>{summary.best ? `${summary.best.spread.toLocaleString()} gil` : "-"}</strong>
          </div>
        </article>
        <article>
          <Gauge size={18} aria-hidden="true" />
          <div>
            <span>Recent sales</span>
            <strong>{summary.totalVolume.toLocaleString()}</strong>
          </div>
        </article>
        <article>
          <ArrowDownUp size={18} aria-hidden="true" />
          <div>
            <span>Opportunities</span>
            <strong>{summary.count}</strong>
          </div>
        </article>
      </section>

      <section className="toolbar" aria-label="Filters">
        <h2 className="srOnly">Filters</h2>
        <div className="toolbarTitle">
          <Filter size={18} aria-hidden="true" />
          <span>Filters</span>
        </div>
        <SelectField
          label="High server"
          value={filters.highWorld ?? ""}
          options={data?.worlds ?? []}
          onChange={(value) => updateFilter("highWorld", value)}
        />
        <SelectField
          label="High data center"
          value={filters.highDataCenter ?? ""}
          options={data?.dataCenters ?? []}
          onChange={(value) => updateFilter("highDataCenter", value)}
        />
        <SelectField
          label="Category"
          value={filters.category ?? ""}
          options={data?.categories ?? []}
          onChange={(value) => updateFilter("category", value)}
        />
        <SelectField
          label="Profile"
          value={filters.profile ?? "all"}
          options={["all", "high-volume", "high-arbitrage"]}
          onChange={(value) => updateFilter("profile", value as OpportunityFilters["profile"])}
        />
        <SelectField
          label="Sort"
          value={filters.sort ?? "best"}
          options={["best", "spread", "spreadPercent", "volume", "velocity"]}
          onChange={(value) => updateFilter("sort", value as OpportunityFilters["sort"])}
        />
        <label className="numberField">
          <span>Min volume</span>
          <input
            min="0"
            type="number"
            value={filters.minVolume ?? ""}
            onChange={(event) =>
              updateFilter("minVolume", event.target.value ? Number(event.target.value) : undefined)
            }
          />
        </label>
      </section>

      {error ? (
        <div className="notice error" role="alert">
          {error instanceof Error ? error.message : "Unable to load opportunities"}
        </div>
      ) : null}
      <OpportunityTable opportunities={opportunities} isLoading={isLoading} />
      {data && data.total > DEFAULT_PAGE_SIZE ? (
        <nav className="pagination" aria-label="Pagination">
          <button
            type="button"
            className="iconButton"
            disabled={currentPage <= 1}
            onClick={() => goToPage(currentPage - 1)}
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
                  className={`paginationPage${p === currentPage ? " active" : ""}`}
                  onClick={() => goToPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === currentPage ? "page" : undefined}
                >
                  {p}
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            className="iconButton"
            disabled={currentPage >= totalPages}
            onClick={() => goToPage(currentPage + 1)}
            aria-label="Next page"
          >
            <span>Next</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </>
  );
}
