import type { OpportunityFilters, OpportunityResponse } from "@xiv-arbitrage/shared";
import { ArrowDownUp, Filter, Gauge, Moon, RefreshCw, Sun, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OpportunityTable } from "./components/OpportunityTable.js";
import { SelectField } from "./components/SelectField.js";

const initialFilters: OpportunityFilters = {
  profile: "all",
  sort: "best",
  limit: 60
};

export function App() {
  const [filters, setFilters] = useState<OpportunityFilters>(initialFilters);
  const [data, setData] = useState<OpportunityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("darkMode") === "true" || window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
    localStorage.setItem("darkMode", String(isDarkMode));
  }, [isDarkMode]);

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
          signal: controller.signal
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

  const summary = useMemo(() => {
    const opportunities = data?.opportunities ?? [];
    const best = opportunities[0];
    const totalVolume = opportunities.reduce((sum, opportunity) => sum + opportunity.recentSales, 0);
    return { best, count: opportunities.length, totalVolume };
  }, [data]);

  function updateFilter<K extends keyof OpportunityFilters>(key: K, value: OpportunityFilters[K]) {
    setFilters((current) => ({
      ...current,
      [key]: value === "" ? undefined : value
    }));
  }

  return (
    <main className="appShell">
      <section className="topBar">
        <div>
          <p className="eyebrow">Final Fantasy XIV Market Board</p>
          <h1>XIV Arbitrage</h1>
        </div>
        <div className="topBarActions">
          <button className="iconButton" type="button" onClick={() => setFilters((current) => ({ ...current }))}>
            <RefreshCw size={18} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            className="iconButton"
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDarkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
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
            onChange={(event) => updateFilter("minVolume", event.target.value ? Number(event.target.value) : undefined)}
          />
        </label>
      </section>

      {error ? <div className="notice error">{error}</div> : null}
      <OpportunityTable opportunities={data?.opportunities ?? []} isLoading={isLoading} />
    </main>
  );
}

