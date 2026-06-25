import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useLocation, useParams, useSearchParams } from "wouter";
import { useItemHistory, useRetriedItemDetails } from "../hooks/api.js";
import { getReturnTo } from "../lib/navigationContext.js";
import { useUiStore } from "../stores/uiStore.js";
import { SaleHistoryView } from "./SaleHistoryView.js";

function ItemHistorySkeleton() {
  return (
    <section className="itemHistoryLoading" role="status" aria-live="polite">
      <span className="srOnly">Loading item history</span>
      <section className="metricStrip skeletonMetrics" aria-hidden="true">
        <article />
        <article />
        <article />
      </section>
      <section className="chartShell skeletonChart" aria-hidden="true" />
      <div className="tableShell skeletonRows" aria-hidden="true" />
    </section>
  );
}

export function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const [searchParams] = useSearchParams();
  const [, navigate] = useLocation();
  const { isDarkMode, toggleDarkMode } = useUiStore();
  const id = itemId ? Number(itemId) : undefined;

  const { data, isLoading, error, refetch } = useItemHistory(id);
  const itemDetails = useRetriedItemDetails(id, data?.itemDetails?.[data.itemId]);

  useEffect(() => {
    document.title = itemDetails
      ? `${itemDetails.name} — Sale History | XIV Arbitrage`
      : "Item History | XIV Arbitrage";
  }, [itemDetails]);

  if (!itemId) {
    return (
      <div className="notice error" role="alert">
        No item specified
      </div>
    );
  }

  if (error) {
    return (
      <div className="notice error" role="alert">
        <strong>Failed to load item history.</strong>
        <span>{error instanceof Error ? error.message : "The item history request failed."}</span>
        <button type="button" className="inlineAction" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    );
  }

  if (isLoading || !data) {
    return <ItemHistorySkeleton />;
  }

  const enrichedData = {
    ...data,
    item: itemDetails ?? { id: data.itemId, name: "Unknown item" },
  };

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
      <SaleHistoryView data={enrichedData} onBack={() => navigate(getReturnTo(searchParams))} />
    </>
  );
}
