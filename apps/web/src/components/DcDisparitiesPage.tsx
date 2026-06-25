import type { DcDisparity, DcPriceInfo } from "@xiv-arbitrage/shared";
import { ChevronLeft, ChevronRight, Copy, Gauge, Moon, Save, Sun, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "wouter";
import { useDcDisparities, useBulkItemDetails, useWorlds } from "../hooks/api.js";
import {
  getItemDetailHref,
  rememberSourceScroll,
  useRestoreSourceScroll,
} from "../lib/navigationContext.js";
import { useUiStore } from "../stores/uiStore.js";
import { SelectField } from "./SelectField.js";

const PAGE_SIZE = 50;
const SAVED_VIEW_STORAGE_KEY = "xiv-arbitrage.saved-disparity-views";
const MAX_SAVED_VIEW_NAME_LENGTH = 60;
const SORT_LABELS = {
  spread: "Gross spread",
  spreadPercent: "Spread %",
};

type SavedView = {
  id: string;
  name: string;
  query: string;
  createdAt: string;
};

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(SAVED_VIEW_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as SavedView[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (view) =>
        typeof view.id === "string" &&
        typeof view.name === "string" &&
        typeof view.query === "string" &&
        typeof view.createdAt === "string",
    );
  } catch {
    return [];
  }
}

function normalizeSavedViewName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_SAVED_VIEW_NAME_LENGTH);
}

export function DcDisparitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isDarkMode, toggleDarkMode } = useUiStore();
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews);
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewMessage, setSavedViewMessage] = useState("");

  useEffect(() => {
    document.title = "DC Disparities | XIV Arbitrage";
  }, []);

  const highDc = searchParams.get("highDc") ?? "";
  const lowDc = searchParams.get("lowDc") ?? "";
  const region = searchParams.get("region") ?? "";
  const sort = searchParams.get("sort") ?? "";
  const minSpread = searchParams.get("minSpread") ?? "";
  const requestedPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const currentQueryString = searchParams.toString();

  const query = useMemo(
    () => ({
      highDc: highDc || undefined,
      lowDc: lowDc || undefined,
      region: region || undefined,
      sort: (sort || undefined) as "spread" | "spreadPercent" | undefined,
      minSpread: minSpread ? Number(minSpread) : undefined,
      perPage: PAGE_SIZE,
    }),
    [highDc, lowDc, region, sort, minSpread],
  );

  const { data, isLoading, error } = useDcDisparities(query, page);
  const { data: worldsData } = useWorlds();

  useRestoreSourceScroll(Boolean(data));

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

  const itemIds = useMemo(() => data?.disparities.map((d) => d.itemId) ?? [], [data?.disparities]);
  const itemDetails = useBulkItemDetails(itemIds, data?.itemDetails);

  const disparities = useMemo(() => {
    if (!data) return [];
    return data.disparities.map((d) => ({
      ...d,
      item: itemDetails.get(d.itemId) ?? { id: d.itemId, name: "Unknown item" },
    }));
  }, [data, itemDetails]);

  const summary = useMemo(() => {
    if (!data) return { count: 0, avgSpread: 0, dcSet: new Set<string>() };
    const dcSet = new Set<string>();
    for (const d of data.disparities) {
      for (const dc of d.allDcs) {
        dcSet.add(dc.dataCenter);
      }
    }
    const withSpread = data.disparities.filter((d) => d.spread > 0);
    const totalSpread = withSpread.reduce((s, d) => s + d.spread, 0);
    return {
      count: data.total,
      avgSpread: withSpread.length > 0 ? Math.round(totalSpread / withSpread.length) : 0,
      dcSet,
    };
  }, [data]);

  const dcOptions = useMemo(() => {
    const set = new Set(worldsData?.dataCenters ?? []);
    for (const d of data?.disparities ?? []) {
      for (const dc of d.allDcs) {
        set.add(dc.dataCenter);
      }
    }
    return [...set].sort();
  }, [data?.disparities, worldsData?.dataCenters]);

  const regionOptions = useMemo(() => {
    const set = new Set(worldsData?.regions ?? []);
    for (const d of data?.disparities ?? []) {
      for (const dc of d.allDcs) {
        set.add(dc.region);
      }
    }
    return [...set].sort();
  }, [data?.disparities, worldsData?.regions]);

  const hasActiveFilters = Boolean(highDc || lowDc || region || sort || minSpread);

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
      if (p <= 1) {
        next.delete("page");
      } else {
        next.set("page", String(p));
      }
      return next;
    });
  }

  function persistSavedViews(nextViews: SavedView[]) {
    setSavedViews(nextViews);
    window.localStorage.setItem(SAVED_VIEW_STORAGE_KEY, JSON.stringify(nextViews));
  }

  function saveCurrentView() {
    const name = normalizeSavedViewName(savedViewName);
    if (!name) {
      setSavedViewMessage("Enter a name before saving this view.");
      return;
    }
    if (savedViews.some((view) => view.name.toLowerCase() === name.toLowerCase())) {
      setSavedViewMessage("A saved view with that name already exists.");
      return;
    }
    const nextViews = [
      ...savedViews,
      {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
        name,
        query: currentQueryString,
        createdAt: new Date().toISOString(),
      },
    ];
    persistSavedViews(nextViews);
    setSavedViewName("");
    setSavedViewMessage(`Saved "${name}".`);
  }

  function loadSavedView(id: string) {
    const view = savedViews.find((saved) => saved.id === id);
    if (!view) return;
    setSearchParams(new URLSearchParams(view.query));
    setSavedViewMessage(`Loaded "${view.name}".`);
  }

  function renameSavedView(id: string) {
    const view = savedViews.find((saved) => saved.id === id);
    if (!view) return;
    const nextName = normalizeSavedViewName(window.prompt("Rename saved view", view.name) ?? "");
    if (!nextName) {
      setSavedViewMessage("Saved view names cannot be empty.");
      return;
    }
    if (
      savedViews.some(
        (saved) => saved.id !== id && saved.name.toLowerCase() === nextName.toLowerCase(),
      )
    ) {
      setSavedViewMessage("A saved view with that name already exists.");
      return;
    }
    persistSavedViews(
      savedViews.map((saved) => (saved.id === id ? { ...saved, name: nextName } : saved)),
    );
    setSavedViewMessage(`Renamed view to "${nextName}".`);
  }

  function deleteSavedView(id: string) {
    const view = savedViews.find((saved) => saved.id === id);
    persistSavedViews(savedViews.filter((saved) => saved.id !== id));
    setSavedViewMessage(view ? `Deleted "${view.name}".` : "Deleted saved view.");
  }

  async function shareCurrentView() {
    const url = `${window.location.origin}${window.location.pathname}${currentQueryString ? `?${currentQueryString}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setSavedViewMessage("Copied this filtered URL to the clipboard.");
    } catch {
      setSavedViewMessage(url);
    }
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
          <p className="eyebrow">Final Fantasy XIV Market Board</p>
          <h1>DC Disparities</h1>
        </div>
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

      <section className="metricStrip" aria-label="Market summary">
        <article>
          <Gauge size={18} aria-hidden="true" />
          <div>
            <span>Matching items</span>
            <strong>{data ? data.total.toLocaleString() : "Loading"}</strong>
          </div>
        </article>
        <article>
          <TrendingUp size={18} aria-hidden="true" />
          <div>
            <span>Average spread on this page</span>
            <strong>{data ? `${summary.avgSpread.toLocaleString()} gil` : "Loading"}</strong>
          </div>
        </article>
        <article>
          <TrendingUp size={18} aria-hidden="true" />
          <div>
            <span>Data centers on this page</span>
            <strong>{data ? summary.dcSet.size : "Loading"}</strong>
          </div>
        </article>
      </section>

      <section className="toolbar">
        <SelectField
          label="High-side sale DC"
          value={highDc}
          options={dcOptions}
          onChange={(v) => updateFilter("highDc", v)}
        />
        <SelectField
          label="Buy-side DC"
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
          options={["spread", "spreadPercent"]}
          optionLabels={SORT_LABELS}
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
        <button
          type="button"
          className="iconButton"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
        >
          Clear filters
        </button>
      </section>

      <section className="savedViews" aria-labelledby="saved-views-title">
        <div className="savedViewsHeader">
          <div>
            <h2 id="saved-views-title">Saved views</h2>
            <p>Save this exact filter, sort, and page state or share it as a URL.</p>
          </div>
          <button
            type="button"
            className="iconButton"
            onClick={shareCurrentView}
            aria-label="Share current view URL"
          >
            <Copy size={16} aria-hidden="true" />
            <span>Share URL</span>
          </button>
        </div>
        <div className="savedViewsControls">
          <label className="selectField" htmlFor="saved-view-name">
            New view name
            <input
              id="saved-view-name"
              type="text"
              maxLength={MAX_SAVED_VIEW_NAME_LENGTH}
              placeholder="e.g. NA high-spread crafts"
              value={savedViewName}
              onChange={(event) => setSavedViewName(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="iconButton"
            onClick={saveCurrentView}
            aria-label="Save current view"
          >
            <Save size={16} aria-hidden="true" />
            <span>Save view</span>
          </button>
          <label className="selectField" htmlFor="saved-view-select">
            Load saved view
            <select
              id="saved-view-select"
              value=""
              onChange={(event) => loadSavedView(event.target.value)}
              disabled={savedViews.length === 0}
            >
              <option value="">
                {savedViews.length === 0 ? "No saved views" : "Choose a view"}
              </option>
              {savedViews.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {savedViews.length > 0 ? (
          <ul className="savedViewsList" aria-label="Saved opportunity views">
            {savedViews.map((view) => (
              <li key={view.id}>
                <button type="button" onClick={() => loadSavedView(view.id)}>
                  {view.name}
                </button>
                <span>{view.query || "Default filters"}</span>
                <div>
                  <button type="button" onClick={() => renameSavedView(view.id)}>
                    Rename
                  </button>
                  <button type="button" onClick={() => deleteSavedView(view.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {savedViewMessage ? (
          <p className="savedViewsMessage" role="status" aria-live="polite">
            {savedViewMessage}
          </p>
        ) : null}
      </section>

      {error ? (
        <div className="notice error" role="alert">
          {error instanceof Error ? error.message : "Failed to load disparities"}
        </div>
      ) : null}

      {isLoading ? (
        <div className="notice contentLoading" role="status" aria-live="polite">
          Loading market data...
        </div>
      ) : data && disparities.length > 0 ? (
        <section className="marketResults" aria-label="DC disparities">
          <div className="marketCards" aria-label="DC disparity cards">
            {disparities.map(
              (
                d: DcDisparity & {
                  item: { id: number; name: string; iconUrl?: string; category?: string };
                },
              ) => (
                <article className="marketCard" key={d.itemId}>
                  <div className="marketCardHeader">
                    <div className="itemCell">
                      {d.item.iconUrl ? (
                        <img src={d.item.iconUrl} alt="" width="42" height="42" loading="lazy" />
                      ) : (
                        <span className="itemIconPlaceholder" aria-hidden="true" />
                      )}
                      <div>
                        <h2>{d.item.name}</h2>
                        <span className="cellSubtext">{d.item.category ?? "Uncategorized"}</span>
                      </div>
                    </div>
                    <Link
                      href={getItemDetailHref(`/items/${d.itemId}`)}
                      className="marketCardAction"
                      onClick={rememberSourceScroll}
                    >
                      View history
                    </Link>
                  </div>
                  {d.allDcs.length === 0 ? (
                    <p className="marketCardEmpty">No sale data available yet.</p>
                  ) : (
                    <>
                      <dl className="marketCardStats">
                        <div>
                          <dt>Cheapest / buy DC</dt>
                          <dd>
                            <strong>{d.lowDc.dataCenter}</strong>
                            <span>
                              {d.lowDc.region} · {d.lowDc.avgPrice.toLocaleString()} gil ·{" "}
                              {d.lowDc.saleCount.toLocaleString()} sales
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt>Costliest / target DC</dt>
                          <dd>
                            <strong>
                              {d.lowDc.dataCenter === d.highDc.dataCenter
                                ? d.allDcs.length > 1
                                  ? "Insufficient data"
                                  : "Only one DC"
                                : d.highDc.dataCenter}
                            </strong>
                            <span>
                              {d.lowDc.dataCenter === d.highDc.dataCenter
                                ? "No spread calculated"
                                : `${d.highDc.region} · ${d.highDc.avgPrice.toLocaleString()} gil · ${d.highDc.saleCount.toLocaleString()} sales`}
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt>Spread</dt>
                          <dd>
                            <strong>
                              {d.spread > 0 ? `${d.spread.toLocaleString()} gil` : "—"}
                            </strong>
                            <span>
                              {d.spread > 0 ? `${d.spreadPercent}% spread` : "No disparity"}
                            </span>
                          </dd>
                        </div>
                      </dl>
                      <div className="dcTags" aria-label="All data center prices">
                        {d.allDcs.map((dc: DcPriceInfo) => (
                          <span
                            key={dc.dataCenter}
                            className={`dcTag${
                              dc.dataCenter === d.highDc.dataCenter
                                ? " dcTagHigh"
                                : dc.dataCenter === d.lowDc.dataCenter
                                  ? " dcTagLow"
                                  : ""
                            }`}
                          >
                            <strong>{dc.dataCenter}</strong>
                            <span>
                              {dc.region} · {dc.avgPrice.toLocaleString()} gil ·{" "}
                              {dc.saleCount.toLocaleString()} sales
                            </span>
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </article>
              ),
            )}
          </div>
          <div className="tableShell" aria-label="DC disparities table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Buy-side DC</th>
                  <th scope="col">High-side sale DC</th>
                  <th scope="col">Gross spread</th>
                  <th scope="col">Spread %</th>
                  <th scope="col">All DCs</th>
                </tr>
              </thead>
              <tbody>
                {disparities.map(
                  (
                    d: DcDisparity & {
                      item: { id: number; name: string; iconUrl?: string; category?: string };
                    },
                  ) => (
                    <tr key={d.itemId}>
                      <td>
                        <div className="itemCell">
                          {d.item.iconUrl ? (
                            <img
                              src={d.item.iconUrl}
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
                              href={getItemDetailHref(`/items/${d.itemId}`)}
                              className="itemNameButton"
                              onClick={rememberSourceScroll}
                              aria-label={`View sale history for ${d.item.name}`}
                            >
                              <strong>{d.item.name}</strong>
                            </Link>
                            <span>{d.item.category ?? "Uncategorized"}</span>
                          </div>
                        </div>
                      </td>
                      {d.allDcs.length === 0 ? (
                        <>
                          <td>
                            <span className="cellSubtext">No sale data</span>
                          </td>
                          <td>
                            <span className="cellSubtext">No sale data</span>
                          </td>
                          <td>
                            <span className="cellSubtext">—</span>
                          </td>
                          <td>
                            <span className="cellSubtext">—</span>
                          </td>
                          <td>
                            <span className="cellSubtext">—</span>
                          </td>
                        </>
                      ) : d.lowDc.dataCenter === d.highDc.dataCenter ? (
                        <>
                          <td>
                            <strong>{d.lowDc.dataCenter}</strong>
                            <span className="cellSubtext">
                              {d.lowDc.region}&ensp;{d.lowDc.avgPrice.toLocaleString()} gil
                            </span>
                          </td>
                          <td>
                            <span className="cellSubtext">
                              {d.allDcs.length > 1 ? "Insufficient data" : "Only one DC"}
                            </span>
                          </td>
                          <td>
                            <span className="cellSubtext">—</span>
                          </td>
                          <td>
                            <span className="cellSubtext">—</span>
                          </td>
                          <td>
                            <div className="dcTags">
                              {d.allDcs.map((dc: DcPriceInfo) => (
                                <span key={dc.dataCenter} className="dcTag">
                                  <strong>{dc.dataCenter}</strong>
                                  <span>
                                    {dc.region} · {dc.avgPrice.toLocaleString()} gil ·{" "}
                                    {dc.saleCount.toLocaleString()} sales
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
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
                              {d.allDcs.map((dc: DcPriceInfo) => (
                                <span
                                  key={dc.dataCenter}
                                  className={`dcTag${
                                    dc.dataCenter === d.highDc.dataCenter
                                      ? " dcTagHigh"
                                      : dc.dataCenter === d.lowDc.dataCenter
                                        ? " dcTagLow"
                                        : ""
                                  }`}
                                >
                                  <strong>{dc.dataCenter}</strong>
                                  <span>
                                    {dc.region} · {dc.avgPrice.toLocaleString()} gil ·{" "}
                                    {dc.saleCount.toLocaleString()} sales
                                  </span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
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
        <div className="notice">No market data available yet.</div>
      ) : null}
    </>
  );
}
