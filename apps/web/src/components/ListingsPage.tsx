import type { ItemListing } from "@xiv-arbitrage/shared";
import { ArrowLeft, ExternalLink, Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useItemListings, useRetriedItemDetails } from "../hooks/api.js";
import { useUiStore } from "../stores/uiStore.js";

function getUniversalisUrl(itemId: number): string {
  return `https://universalis.app/market/${itemId}`;
}

export function ListingsPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const [location, navigate] = useLocation();
  const { isDarkMode, toggleDarkMode } = useUiStore();
  const id = itemId ? Number(itemId) : undefined;

  const { data, isLoading, error } = useItemListings(id);
  const itemDetails = useRetriedItemDetails(id, data?.itemDetails?.[data.itemId]);

  useEffect(() => {
    document.title = itemDetails
      ? `${itemDetails.name} — Listings | XIV Arbitrage`
      : "Item Listings | XIV Arbitrage";
  }, [itemDetails]);

  if (!itemId) {
    return <div className="notice error">No item specified</div>;
  }

  return (
    <>
      <div className="topBarActions" style={{ justifyContent: "flex-end", marginBottom: 16 }}>
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

      <section className="itemDetailHeader">
        <div className="topBarLeft">
          <button
            type="button"
            className="iconButton"
            onClick={() => navigate("/")}
            aria-label="Go back to opportunities"
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Back</span>
          </button>
          {itemDetails?.iconUrl ? (
            <img
              src={itemDetails.iconUrl}
              alt=""
              width="48"
              height="48"
              className="itemDetailIcon"
              loading="lazy"
            />
          ) : (
            <span className="itemDetailIcon" aria-hidden="true" />
          )}
          <div>
            <h1>{itemDetails?.name ?? (isLoading ? "Loading..." : "Unknown item")}</h1>
            <p className="eyebrow">{itemDetails?.category ?? "Uncategorized"}</p>
          </div>
        </div>
        <div className="topBarActions">
          <a
            href={data ? getUniversalisUrl(data.itemId) : "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="iconButton"
            aria-label="Open Universalis in new tab"
          >
            <ExternalLink size={18} aria-hidden="true" />
            <span>Universalis</span>
          </a>
        </div>
      </section>

      <nav className="itemTabs" aria-label="Item details">
        <Link
          href={`/items/${itemId}`}
          className={(isActive) => `itemTab${isActive ? " active" : ""}`}
          aria-current={location === `/items/${itemId}` ? "page" : undefined}
        >
          History
        </Link>
        <Link
          href={`/items/${itemId}/listings`}
          className={(isActive) => `itemTab${isActive ? " active" : ""}`}
          aria-current={location === `/items/${itemId}/listings` ? "page" : undefined}
        >
          Listings
        </Link>
      </nav>

      {error ? (
        <div className="notice error" role="alert">
          {error instanceof Error ? error.message : "Failed to load listings"}
        </div>
      ) : null}

      {isLoading ? (
        <div className="notice contentLoading" role="status" aria-live="polite">
          Loading listings...
        </div>
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
            <section className="marketResults" aria-label="Item listings">
              <div className="marketCards" aria-label="Listing cards">
                {data.listings.map((listing: ItemListing, i: number) => (
                  <article
                    className="marketCard"
                    key={`${listing.worldId}-${listing.pricePerUnit}-${i}`}
                  >
                    <div className="marketCardHeader">
                      <div>
                        <h2>{listing.worldName}</h2>
                        <span className="cellSubtext">{listing.dataCenter}</span>
                      </div>
                    </div>
                    <dl className="marketCardStats">
                      <div>
                        <dt>Listed price</dt>
                        <dd>
                          <strong>{listing.pricePerUnit.toLocaleString()} gil</strong>
                          <span>Quantity {listing.quantity.toLocaleString()}</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Recent comparison avg</dt>
                        <dd>
                          <strong>{listing.recentAvgPrice.toLocaleString()} gil</strong>
                          <span>DC IQR average</span>
                        </dd>
                      </div>
                      <div>
                        <dt>Discount</dt>
                        <dd>
                          <strong className="discountPositive">
                            {listing.discount.toLocaleString()} gil
                          </strong>
                          <span>{listing.discountPercent}% below avg</span>
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
              <div className="tableShell" aria-label="Listings table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Server</th>
                      <th scope="col">Data Center</th>
                      <th scope="col">Listed price</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Discount</th>
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
                            <span className="discountPct">
                              {listing.discountPercent}% below avg
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : null}
    </>
  );
}
