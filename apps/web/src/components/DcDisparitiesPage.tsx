import type { DcDisparityResponse } from "@xiv-arbitrage/shared";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Gauge,
  Moon,
  Sun,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { SearchBox } from "./SearchBox.js";
import { SelectField } from "./SelectField.js";

const PAGE_SIZE = 50;

export function DcDisparitiesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<DcDisparityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDarkMode ? "dark" : "light");
    localStorage.setItem("darkMode", String(isDarkMode));
  }, [isDarkMode]);

  const highDc = searchParams.get("highDc") ?? "";
  const lowDc = searchParams.get("lowDc") ?? "";
  const region = searchParams.get("region") ?? "";
  const sort = searchParams.get("sort") ?? "";
  const minSpread = searchParams.get("minSpread") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (highDc) params.set("highDc", highDc);
        if (lowDc) params.set("lowDc", lowDc);
        if (region) params.set("region", region);
        if (sort) params.set("sort", sort);
        if (minSpread) params.set("minSpread", minSpread);
        if (page > 1) params.set("page", String(page));
        params.set("perPage", String(PAGE_SIZE));

        const response = await fetch(`/api/dc-disparities?${params}`, {
          signal: controller.signal,
        });
        if (response.ok) {
          setData((await response.json()) as DcDisparityResponse);
        } else {
          setError(`API returned ${response.status}`);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load disparities");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [highDc, lowDc, region, sort, minSpread, page]);

  const summary = useMemo(() => {
    if (!data) return { count: 0, avgSpread: 0, dcSet: new Set<string>() };
    const dcSet = new Set<string>();
    for (const d of data.disparities) {
      for (const dc of d.allDcs) {
        dcSet.add(dc.dataCenter);
      }
    }
    const totalSpread = data.disparities.reduce((s, d) => s + d.spread, 0);
    return {
      count: data.total,
      avgSpread:
        data.disparities.length > 0 ? Math.round(totalSpread / data.disparities.length) : 0,
      dcSet,
    };
  }, [data]);

  const dcOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const d of data.disparities) {
      for (const dc of d.allDcs) {
        set.add(dc.dataCenter);
      }
    }
    return [...set].sort();
  }, [data]);

  const regionOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const d of data.disparities) {
      for (const dc of d.allDcs) {
        set.add(dc.region);
      }
    }
    return [...set].sort();
  }, [data]);

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

  function goToPage(p: number) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) {
        next.delete("page");
      } else {
        next.set("page", String(p));
      }
      return next;
    });
  }

  function getPageNumbers(): (number | "ellipsis")[] {
    if (!data || data.totalPages <= 1) return [];
    const { totalPages, page: currentPage } = data;
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
          <p className="eyebrow">Cross-Data Center Price Gaps</p>
          <h1>DC Price Disparities</h1>
        </div>
        <SearchBox />
        <div className="topBarActions">
          <NavLink to="/" className="iconButton" aria-label="View arbitrage opportunities">
            <span>Arbitrage</span>
          </NavLink>
          <NavLink to="/bargains" className="iconButton" aria-label="View market bargains">
            <TrendingUp size={16} aria-hidden="true" />
            <span>Bargains</span>
          </NavLink>
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
            type="button"
            className="iconButton"
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

      {data && data.disparities.length > 0 ? (
        <section className="metricStrip" aria-label="Disparity summary">
          <article>
            <Gauge size={18} aria-hidden="true" />
            <div>
              <span>Items with disparities</span>
              <strong>{summary.count}</strong>
            </div>
          </article>
          <article>
            <TrendingUp size={18} aria-hidden="true" />
            <div>
              <span>Average spread</span>
              <strong>{summary.avgSpread.toLocaleString()} gil</strong>
            </div>
          </article>
          <article>
            <TrendingUp size={18} aria-hidden="true" />
            <div>
              <span>Data centers</span>
              <strong>{summary.dcSet.size}</strong>
            </div>
          </article>
        </section>
      ) : null}

      <section className="toolbar">
        <SelectField
          label="Costliest DC"
          value={highDc}
          options={dcOptions}
          onChange={(v) => updateFilter("highDc", v)}
        />
        <SelectField
          label="Cheapest DC"
          value={lowDc}
          options={dcOptions}
          onChange={(v) => updateFilter("lowDc", v)}
        />
        <SelectField
          label="Region"
          value={region}
          options={regionOptions}
          onChange={(v) => updateFilter("region", v)}
        />
        <SelectField
          label="Sort by"
          value={sort}
          options={["spread", "spreadPercent", "item"]}
          onChange={(v) => updateFilter("sort", v)}
        />
        <div className="selectField">
          <label htmlFor="min-spread">Min spread</label>
          <input
            id="min-spread"
            type="number"
            min={0}
            step={1000}
            placeholder="0"
            value={minSpread}
            onChange={(e) => updateFilter("minSpread", e.target.value)}
          />
        </div>
      </section>

      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="notice" role="status" aria-live="polite">
          Computing data center price disparities...
        </div>
      ) : data && data.disparities.length > 0 ? (
        <section className="tableShell" aria-label="DC disparities table">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Cheapest DC</th>
                <th scope="col">Costliest DC</th>
                <th scope="col">Spread</th>
                <th scope="col">Spread %</th>
                <th scope="col">All DCs</th>
              </tr>
            </thead>
            <tbody>
              {data.disparities.map((d) => (
                <tr
                  key={d.itemId}
                  className="clickable"
                  onClick={() => navigate(`/items/${d.itemId}`)}
                >
                  <td>
                    <div className="itemCell">
                      {d.item.iconUrl ? <img src={d.item.iconUrl} alt="" loading="lazy" /> : null}
                      <div>
                        <button
                          type="button"
                          className="itemNameButton"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/items/${d.itemId}`);
                          }}
                          aria-label={`View sale history for ${d.item.name}`}
                        >
                          <strong>{d.item.name}</strong>
                        </button>
                        <span>{d.item.category ?? "Uncategorized"}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>{d.lowDc.dataCenter}</strong>
                    <span className="cellSubtext">
                      {d.lowDc.region}&ensp;{d.lowDc.avgPrice.toLocaleString()} gil
                    </span>
                  </td>
                  <td>
                    <strong>{d.highDc.dataCenter}</strong>
                    <span className="cellSubtext">
                      {d.highDc.region}&ensp;{d.highDc.avgPrice.toLocaleString()} gil
                    </span>
                  </td>
                  <td>
                    <strong>{d.spread.toLocaleString()} gil</strong>
                  </td>
                  <td>
                    <strong>{d.spreadPercent}%</strong>
                  </td>
                  <td>
                    <div className="dcTags">
                      {d.allDcs.map((dc) => (
                        <span
                          key={dc.dataCenter}
                          className={`dcTag${
                            dc.dataCenter === d.highDc.dataCenter
                              ? " dcTagHigh"
                              : dc.dataCenter === d.lowDc.dataCenter
                                ? " dcTagLow"
                                : ""
                          }`}
                          title={`${dc.dataCenter} (${dc.region}): ${dc.avgPrice.toLocaleString()} gil (${dc.saleCount} sales)`}
                        >
                          {dc.dataCenter}&thinsp;{dc.avgPrice.toLocaleString()}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tableFooter">
            Page {data.page} of {data.totalPages} &mdash; {data.total} total items &middot;
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
                disabled={page >= (data.totalPages ?? 1)}
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
          No cross-DC disparities found. Not enough items have sale data across multiple data
          centers.
        </div>
      ) : null}
    </>
  );
}
