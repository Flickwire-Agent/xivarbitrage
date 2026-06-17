import type { BargainsResponse } from "@xiv-arbitrage/shared";
import { ExternalLink, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { SearchBox } from "./SearchBox.js";

export function BargainsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<BargainsResponse | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/bargains", { signal: controller.signal });
        if (response.ok) {
          setData((await response.json()) as BargainsResponse);
        } else {
          setError(`API returned ${response.status}`);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load bargains");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, []);

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

      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="notice" role="status" aria-live="polite">
          Scanning market for bargains...
        </div>
      ) : data && data.bargains.length > 0 ? (
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
              {data.bargains.map((b, i) => (
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
              ))}
            </tbody>
          </table>
          <p className="tableFooter">
            Showing top {data.bargains.length} bargains across all items. Refreshed{" "}
            {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
        </section>
      ) : data ? (
        <div className="notice">No bargains found across any items yet.</div>
      ) : null}
    </>
  );
}
