import type { ItemHistoryResponse } from "@xiv-arbitrage/shared";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SaleHistoryView } from "./SaleHistoryView.js";

export function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ItemHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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

      try {
        const response = await fetch(`/api/items/${itemId}/history`, {
          signal: controller.signal,
        });
        if (response.ok) {
          setData((await response.json()) as ItemHistoryResponse);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          console.error("Failed to load item history:", loadError);
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
    return (
      <div className="notice error" role="alert">
        No item specified
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="notice" role="status" aria-live="polite">
        Loading...
      </div>
    );
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
      <SaleHistoryView data={data} onBack={() => navigate("/")} />
    </>
  );
}
