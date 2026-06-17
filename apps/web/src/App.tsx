import type { OpportunityFilters, OpportunityResponse } from "@xiv-arbitrage/shared";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Filter,
  Gauge,
  Moon,
  RefreshCw,
  Sun,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OpportunityTable } from "./components/OpportunityTable.js";
import { SelectField } from "./components/SelectField.js";

const PAGE_SIZE = 50;

const initialFilters: OpportunityFilters = {
  profile: "all",
  sort: "best",
};

export function App() {
  const [filters, setFilters] = useState<OpportunityFilters>(initialFilters);
  const [data, setData] = useState<OpportunityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return (
        localStorage.getItem("darkMode") === "true" ||
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
    }
    return false;
  });
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
    localStorage.setItem("darkMode", String(isDarkMode));
  }, [isDarkMode]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== "" && value !== "all") {
          params.set(key, String(value));
        }
      }

      try {
        const response = await fetch(`/api/opportunities?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        setData((await response.json()) as OpportunityResponse);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load opportunities");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [filters]);

  const allOpportunities = data?.opportunities ?? [];

  const totalPages = Math.max(1, Math.ceil(allOpportunities.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageStart = (clampedPage - 1) * PAGE_SIZE;
  const paginatedOpportunities = allOpportunities.slice(pageStart, pageStart + PAGE_SIZE);

  const summary = useMemo(() => {
    const best = allOpportunities[0];
    const totalVolume = allOpportunities.reduce(
      (sum, opportunity) => sum + opportunity.recentSales,
      0,
    );
    return { best, count: allOpportunities.length, totalVolume };
  }, [data]);

  function updateFilter<K extends keyof OpportunityFilters>(key: K, value: OpportunityFilters[K]) {
    setFilters((current) => ({
      ...current,
      [key]: value === "" ? undefined : value,
    }));
  }

  function goToPage(p: number) {
    setPage(Math.max(1, Math.min(p, totalPages)));
  }

  function getPageNumbers(): (number | "ellipsis")[] {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (clampedPage > 3) pages.push("ellipsis");
      const start = Math.max(2, clampedPage - 1);
      const end = Math.min(totalPages - 1, clampedPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (clampedPage < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  }

  return (
    <main className="appShell">
      <section className="topBar">
        <div>
          <p className="eyebrow">Final Fantasy XIV Market Board</p>
          <h1>XIV Arbitrage</h1>
        </div>
        <div className="topBarActions">
          <button
            className="iconButton"
            type="button"
            onClick={() => setFilters((current) => ({ ...current }))}
          >
            <RefreshCw size={18} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            className="iconButton"
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
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

      {error ? <div className="notice error">{error}</div> : null}
      <OpportunityTable opportunities={paginatedOpportunities} isLoading={isLoading} />
      {allOpportunities.length > PAGE_SIZE ? (
        <nav className="pagination" aria-label="Pagination">
          <button
            type="button"
            className="iconButton"
            disabled={clampedPage <= 1}
            onClick={() => goToPage(clampedPage - 1)}
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
                  className={`paginationPage${p === clampedPage ? " active" : ""}`}
                  onClick={() => goToPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === clampedPage ? "page" : undefined}
                >
                  {p}
                </button>
              ),
            )}
          </div>
          <button
            type="button"
            className="iconButton"
            disabled={clampedPage >= totalPages}
            onClick={() => goToPage(clampedPage + 1)}
            aria-label="Next page"
          >
            <span>Next</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </main>
  );
}
