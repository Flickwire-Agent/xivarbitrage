import type { ItemHistoryResponse } from "@xiv-arbitrage/shared";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { CSSProperties } from "react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useWorlds } from "../hooks/api.js";
import { getDataCenterLineColor, getDataCenterWorldColor } from "../lib/chartColors.js";
import type { ItemDetails } from "../lib/xivapi.js";

const SaleHistoryChart = lazy(() =>
  import("./SaleHistoryChart.js").then((m) => ({ default: m.SaleHistoryChart })),
);

interface EnrichedItemHistoryResponse extends ItemHistoryResponse {
  item: ItemDetails;
}

interface SaleHistoryViewProps {
  data: EnrichedItemHistoryResponse;
  onBack: () => void;
}

function getUniversalisUrl(itemId: number): string {
  return `https://universalis.app/market/${itemId}`;
}

export function SaleHistoryView({ data, onBack }: SaleHistoryViewProps) {
  const [location] = useLocation();
  const [visibleWorlds, setVisibleWorlds] = useState(() => new Set(data.worlds));
  const [hiddenDcs, setHiddenDcs] = useState(() => new Set<string>());
  const { data: worldsData } = useWorlds();

  const saleStats = useMemo(() => {
    if (data.sales.length === 0) return null;
    const prices = data.sales.map((s) => s.pricePerUnit);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    return { min, max, avg, count: data.sales.length };
  }, [data]);

  const worldIdToDc = useMemo(() => {
    if (worldsData?.worldIdToDc) return worldsData.worldIdToDc;
    const map: Record<number, string> = {};
    for (const w of worldsData?.worlds ?? []) {
      map[w.id] = w.dataCenter;
    }
    return map;
  }, [worldsData]);

  const { dcs, worldsByDc, worldToDc, worldColors } = useMemo(() => {
    const nextWorldToDc = new Map<string, string>();
    for (const sale of data.sales) {
      nextWorldToDc.set(sale.worldName, worldIdToDc[sale.worldId] ?? "Unknown");
    }

    const nextWorldsByDc = new Map<string, string[]>();
    for (const world of data.worlds) {
      const dc = nextWorldToDc.get(world) ?? "Unknown";
      const worlds = nextWorldsByDc.get(dc) ?? [];
      worlds.push(world);
      nextWorldsByDc.set(dc, worlds);
    }

    const nextDcs = [...nextWorldsByDc.keys()].sort();
    const nextWorldColors = new Map<string, string>();
    nextDcs.forEach((dc, dcIndex) => {
      const worlds = nextWorldsByDc.get(dc)!.sort();
      worlds.forEach((world, worldIndex) => {
        nextWorldColors.set(world, getDataCenterWorldColor(dcIndex, worldIndex));
      });
    });

    return {
      dcs: nextDcs,
      worldsByDc: nextWorldsByDc,
      worldToDc: nextWorldToDc,
      worldColors: nextWorldColors,
    };
  }, [data.sales, data.worlds, worldIdToDc]);

  const visibleDcs = useMemo(
    () => new Set(dcs.filter((dc) => !hiddenDcs.has(dc))),
    [dcs, hiddenDcs],
  );

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

  function toggleDataCenterLine(dc: string) {
    setHiddenDcs((prev) => {
      const next = new Set(prev);
      if (next.has(dc)) {
        next.delete(dc);
      } else {
        next.add(dc);
      }
      return next;
    });
  }

  function toggleDataCenterWorlds(dc: string) {
    const dcWorlds = worldsByDc.get(dc) ?? [];
    const dcHidden = dcWorlds.every((world) => !visibleWorlds.has(world));
    setVisibleWorlds((prev) => {
      const next = new Set(prev);
      for (const world of dcWorlds) {
        if (dcHidden) {
          next.add(world);
        } else {
          next.delete(world);
        }
      }
      return next;
    });
  }

  function toggleAllDataCenterLines() {
    if (dcs.every((dc) => hiddenDcs.has(dc))) {
      setHiddenDcs(new Set());
    } else {
      setHiddenDcs(new Set(dcs));
    }
  }

  function colorStyle(color: string) {
    return { "--tag-color": color } as CSSProperties;
  }

  const allHidden = data.worlds.every((w) => !visibleWorlds.has(w));
  const allDcsHidden = dcs.every((dc) => hiddenDcs.has(dc));

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
              <img
                src={data.item.iconUrl}
                alt=""
                width="48"
                height="48"
                className="itemDetailIcon"
                loading="lazy"
              />
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
            aria-label="Open Universalis in new tab"
          >
            <ExternalLink size={18} aria-hidden="true" />
            <span>Universalis</span>
          </a>
        </div>
      </section>

      <nav className="itemTabs" role="tablist" aria-label="Item details">
        <Link
          href={`/items/${data.itemId}`}
          className={(isActive) => `itemTab${isActive ? " active" : ""}`}
          role="tab"
          aria-selected={location === `/items/${data.itemId}`}
        >
          History
        </Link>
        <Link
          href={`/items/${data.itemId}/listings`}
          className={(isActive) => `itemTab${isActive ? " active" : ""}`}
          role="tab"
          aria-selected={location === `/items/${data.itemId}/listings`}
        >
          Listings
        </Link>
      </nav>

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

      <section className="chartShell" aria-label="Server filter">
        <div className="chartServerFilter">
          <span className="chartServerFilterLabel">Data center lines</span>
          <button
            type="button"
            className="chartToggleAll"
            onClick={toggleAllDataCenterLines}
            aria-label={allDcsHidden ? "Show all data center lines" : "Hide all data center lines"}
          >
            {allDcsHidden ? "Show all" : "Hide all"}
          </button>
        </div>
        <div className="chartServerTags" role="group" aria-label="Toggle data center lines">
          {dcs.map((dc, dcIndex) => (
            <button
              key={dc}
              type="button"
              className="serverTag dataCenterTag"
              style={colorStyle(getDataCenterLineColor(dcIndex))}
              onClick={() => toggleDataCenterLine(dc)}
              aria-pressed={!hiddenDcs.has(dc)}
            >
              <span className="chartSwatch" aria-hidden="true" />
              {dc} line
            </button>
          ))}
        </div>

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
            aria-label={allHidden ? "Show all servers" : "Hide all servers"}
          >
            {allHidden ? "Show all" : "Hide all"}
          </button>
        </div>
        <div className="chartDcGroups">
          {dcs.map((dc, dcIndex) => {
            const dcWorlds = worldsByDc.get(dc) ?? [];
            const dcHidden = dcWorlds.every((world) => !visibleWorlds.has(world));

            return (
              <div className="chartDcGroup" key={dc}>
                <div className="chartDcGroupHeader">
                  <span>
                    <span
                      className="chartSwatch"
                      style={colorStyle(getDataCenterLineColor(dcIndex))}
                      aria-hidden="true"
                    />
                    {dc}
                  </span>
                  <button
                    type="button"
                    className="chartToggleAll"
                    onClick={() => toggleDataCenterWorlds(dc)}
                    aria-label={`${dcHidden ? "Show" : "Hide"} ${dc} servers`}
                  >
                    {dcHidden ? "Show servers" : "Hide servers"}
                  </button>
                </div>
                <div
                  className="chartServerTags"
                  role="group"
                  aria-label={`Toggle ${dc} server visibility`}
                >
                  {dcWorlds.map((world) => (
                    <button
                      key={world}
                      type="button"
                      className="serverTag"
                      style={colorStyle(worldColors.get(world) ?? getDataCenterLineColor(dcIndex))}
                      onClick={() => toggleWorld(world)}
                      aria-pressed={visibleWorlds.has(world)}
                    >
                      <span className="chartSwatch" aria-hidden="true" />
                      {world}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="chartShell" aria-label="Sale history chart">
        <Suspense
          fallback={
            <div className="notice" role="status" aria-live="polite">
              Loading chart…
            </div>
          }
        >
          <SaleHistoryChart
            sales={data.sales}
            visibleWorlds={visibleWorlds}
            visibleDcs={visibleDcs}
            worldIdToDc={worldIdToDc}
            worldToDc={worldToDc}
          />
        </Suspense>
      </section>
    </div>
  );
}
