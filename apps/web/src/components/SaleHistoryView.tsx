import type { ItemHistoryResponse } from "@xiv-arbitrage/shared";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { SaleHistoryChart } from "./SaleHistoryChart.js";

interface SaleHistoryViewProps {
  data: ItemHistoryResponse;
  onBack: () => void;
}

function getUniversalisUrl(itemId: number): string {
  return `https://universalis.app/market/${itemId}`;
}

export function SaleHistoryView({ data, onBack }: SaleHistoryViewProps) {
  const [visibleWorlds, setVisibleWorlds] = useState(() => new Set(data.worlds));

  const saleStats = useMemo(() => {
    if (data.sales.length === 0) return null;
    const prices = data.sales.map((s) => s.pricePerUnit);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    return { min, max, avg, count: data.sales.length };
  }, [data]);

  function toggleWorld(world: string) {
    setVisibleWorlds((prev) => {
      const next = new Set(prev);
      if (next.has(world)) {
        next.delete(world);
      } else {
        next.add(world);
      }
      return next;
    });
  }

  const allHidden = data.worlds.every((w) => !visibleWorlds.has(w));

  return (
    <div>
      <section className="topBar">
        <div className="topBarLeft">
          <button type="button" className="iconButton" onClick={onBack}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>Back</span>
          </button>
          <div className="itemDetailTitle">
            {data.item.iconUrl ? (
              <img src={data.item.iconUrl} alt="" className="itemDetailIcon" loading="lazy" />
            ) : null}
            <div>
              <h1>{data.item.name}</h1>
              <p className="eyebrow">{data.item.category ?? "Uncategorized"}</p>
            </div>
          </div>
        </div>
        <div className="topBarActions">
          <a
            href={getUniversalisUrl(data.itemId)}
            target="_blank"
            rel="noopener noreferrer"
            className="iconButton"
          >
            <ExternalLink size={18} aria-hidden="true" />
            <span>Universalis</span>
          </a>
        </div>
      </section>

      {saleStats ? (
        <section className="metricStrip" aria-label="Sale summary">
          <article>
            <div>
              <span>Total sales</span>
              <strong>{saleStats.count.toLocaleString()}</strong>
            </div>
          </article>
          <article>
            <div>
              <span>Min price</span>
              <strong>{saleStats.min.toLocaleString()} gil</strong>
            </div>
          </article>
          <article>
            <div>
              <span>Max price</span>
              <strong>{saleStats.max.toLocaleString()} gil</strong>
            </div>
          </article>
          <article>
            <div>
              <span>Average price</span>
              <strong>{saleStats.avg.toLocaleString()} gil</strong>
            </div>
          </article>
        </section>
      ) : null}

      <section className="chartShell">
        <div className="chartServerFilter">
          <span className="chartServerFilterLabel">Servers</span>
          <button
            type="button"
            className="chartToggleAll"
            onClick={() => {
              if (allHidden) {
                setVisibleWorlds(new Set(data.worlds));
              } else {
                setVisibleWorlds(new Set());
              }
            }}
          >
            {allHidden ? "Show all" : "Hide all"}
          </button>
        </div>
        <div className="chartServerTags">
          {data.worlds.map((world) => (
            <label key={world} className="serverTag">
              <input
                type="checkbox"
                checked={visibleWorlds.has(world)}
                onChange={() => toggleWorld(world)}
              />
              <span>{world}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="chartShell">
        <SaleHistoryChart sales={data.sales} visibleWorlds={visibleWorlds} />
      </section>
    </div>
  );
}
