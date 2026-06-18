import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { useLocation, useSearchParams } from "wouter";
import { useBargains, useBulkItemDetails } from "../hooks/api.js";
import { useUiStore } from "../stores/uiStore.js";
import { SearchBox } from "./SearchBox.js";
import type { BargainListing } from "@xiv-arbitrage/shared";
import { useEffect, useMemo } from "react";

export function BargainsPage() {
  const [, navigate] = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isDarkMode, toggleDarkMode } = useUiStore();

  useEffect(() => {
    document.title = "Market Bargains | XIV Arbitrage";
  }, []);

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  const { data, isLoading, error } = useBargains(page);

  const itemIds = useMemo(() => data?.bargains.map((b) => b.itemId) ?? [], [data?.bargains]);
  const itemDetails = useBulkItemDetails(itemIds);

  const bargains = useMemo(() => {
    if (!data) return [];
    return data.bargains.map((b) => ({
      ...b,
      item: itemDetails.get(b.itemId) ?? { id: b.itemId, name: `Item ${b.itemId}` },
    }));
  }, [data, itemDetails]);

  const totalPages = data?.totalPages ?? 1;
  const currentPage = data?.page ?? 1;

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

      {isLoading ? (
        <div className="notice" role="status" aria-live="polite">
          Scanning market for bargains...
        </div>
      ) : data && bargains.length > 0 ? (
        <section className="tableShell" aria-label="Bargains table">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Server</th>
                <th scope="col">Data Center</th>
                <th scope="col">Listed price</th>
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
                  <tr
                    key={`${b.itemId}-${b.worldId}-${b.pricePerUnit}-${i}`}
                    className="clickable"
                    onClick={() => navigate(`/items/${b.itemId}/listings`)}
                  >
                    <td>
                      <div className="itemCell">
                        {b.item.iconUrl ? (
                          <img src={b.item.iconUrl} alt="" width="42" height="42" loading="lazy" />
                        ) : null}
                        <div>
                          <strong>{b.item.name}</strong>
                          <span className="cellSubtext">{b.item.category ?? "Uncategorized"}</span>
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
        <div className="notice">No bargains found across any items yet.</div>
      ) : null}
    </>
  );
}
