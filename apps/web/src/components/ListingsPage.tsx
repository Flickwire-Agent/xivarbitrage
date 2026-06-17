import type { ItemListing, ListingsResponse } from "@xiv-arbitrage/shared";
import { ArrowLeft, ExternalLink, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";

function getUniversalisUrl(itemId: number): string {
  return `https://universalis.app/market/${itemId}`;
}

export function ListingsPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ListingsResponse | null>(null);
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
    if (!itemId) return;

    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/items/${itemId}/listings`, {
          signal: controller.signal,
        });
        if (response.ok) {
          setData((await response.json()) as ListingsResponse);
        } else {
          setError(`API returned ${response.status}`);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load listings");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [itemId]);

  if (!itemId) {
    return <div className="notice error">No item specified</div>;
  }

  return (
    <>
      <div className="topBarActions" style={{ justifyContent: "flex-end", marginBottom: 16 }}>
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

      <section className="itemDetailHeader">
        <div className="topBarLeft">
          <button type="button" className="iconButton" onClick={() => navigate("/")}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Back</span>
          </button>
          {data?.item.iconUrl ? (
            <img src={data.item.iconUrl} alt="" className="itemDetailIcon" loading="lazy" />
          ) : null}
          <div>
            <h1>{data?.item.name ?? "Loading..."}</h1>
            <p className="eyebrow">{data?.item.category ?? "Uncategorized"}</p>
          </div>
        </div>
        <div className="topBarActions">
          <a
            href={data ? getUniversalisUrl(data.itemId) : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="iconButton"
          >
            <ExternalLink size={18} aria-hidden="true" />
            <span>Universalis</span>
          </a>
        </div>
      </section>

      <nav className="itemTabs">
        <NavLink
          to={`/items/${itemId}`}
          end
          className={({ isActive }) => `itemTab${isActive ? " active" : ""}`}
        >
          History
        </NavLink>
        <NavLink
          to={`/items/${itemId}/listings`}
          className={({ isActive }) => `itemTab${isActive ? " active" : ""}`}
        >
          Listings
        </NavLink>
      </nav>

      {error ? <div className="notice error">{error}</div> : null}

      {isLoading ? (
        <div className="notice">Loading listings...</div>
      ) : data ? (
        <>
          <section className="metricStrip" aria-label="Market summary">
            <article>
              <div>
                <span>Recent sales</span>
                <strong>{data.saleStats?.count.toLocaleString() ?? "N/A"}</strong>
              </div>
            </article>
            <article>
              <div>
                <span>Current listings</span>
                <strong>{data.listings.length.toLocaleString()}</strong>
              </div>
            </article>
            {data.saleStats?.perDataCenter
              ? Object.entries(data.saleStats.perDataCenter).map(([dc, stats]) => (
                  <article key={dc}>
                    <div>
                      <span>{dc} avg</span>
                      <strong>{stats.avgPrice.toLocaleString()} gil</strong>
                    </div>
                  </article>
                ))
              : null}
          </section>

          {data.listings.length === 0 ? (
            <div className="notice">No current listings are priced below the recent average.</div>
          ) : (
            <section className="tableShell">
              <table>
                <thead>
                  <tr>
                    <th>Server</th>
                    <th>Data Center</th>
                    <th>Listed price</th>
                    <th>Quantity</th>
                    <th>Discount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.listings.map((listing: ItemListing, i: number) => (
                    <tr key={`${listing.worldId}-${listing.pricePerUnit}-${i}`}>
                      <td>
                        <strong>{listing.worldName}</strong>
                      </td>
                      <td>{listing.dataCenter}</td>
                      <td>
                        <strong>{listing.pricePerUnit.toLocaleString()} gil</strong>
                      </td>
                      <td>{listing.quantity.toLocaleString()}</td>
                      <td>
                        <div className="discountCell">
                          <strong className="discountPositive">
                            {listing.discount.toLocaleString()} gil
                          </strong>
                          <span className="discountPct">{listing.discountPercent}% below avg</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      ) : null}
    </>
  );
}
