import { ExternalLink, Moon, Sun } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useBargains, useBulkItemDetails } from "../hooks/api.js";
import { useUiStore } from "../stores/uiStore.js";
import { SearchBox } from "./SearchBox.js";
import type { BargainListing } from "@xiv-arbitrage/shared";
import { useMemo } from "react";

export function BargainsPage() {
  const navigate = useNavigate();
  const { isDarkMode, toggleDarkMode } = useUiStore();

  const { data, isLoading, error } = useBargains();

  const itemIds = useMemo(() => data?.bargains.map((b) => b.itemId) ?? [], [data?.bargains]);
  const itemDetails = useBulkItemDetails(itemIds);

  const bargains = useMemo(() => {
    if (!data) return [];
    return data.bargains.map((b) => ({
      ...b,
      item: itemDetails.get(b.itemId) ?? { id: b.itemId, name: `Item ${b.itemId}` },
    }));
  }, [data, itemDetails]);

  return (
    <>
      <section className="topBar">
        <div>
          <p className="eyebrow">Best Deals</p>
          <h1>Market Bargains</h1>
        </div>
        <SearchBox />
        <div className="topBarActions">
          <NavLink to="/" className="iconButton" aria-label="View arbitrage opportunities">
            <span>Arbitrage</span>
          </NavLink>
          <NavLink
            to="/dc-disparities"
            className="iconButton"
            aria-label="View data center price disparities"
          >
            <span>DC Gaps</span>
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
                <th scope="col">DC avg</th>
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
                          <img src={b.item.iconUrl} alt="" className="miniIcon" loading="lazy" />
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
            Showing top {bargains.length} bargains across all items. Refreshed{" "}
            {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
        </section>
      ) : data ? (
        <div className="notice">No bargains found across any items yet.</div>
      ) : null}
    </>
  );
}
