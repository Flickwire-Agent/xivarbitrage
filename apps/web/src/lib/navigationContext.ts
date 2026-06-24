import { useEffect } from "react";

const RETURN_TO_PARAM = "returnTo";
const SCROLL_STORAGE_PREFIX = "xiv-arbitrage.scroll:";

function getCurrentPathWithSearch() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getScrollStorageKey(path: string) {
  return `${SCROLL_STORAGE_PREFIX}${path}`;
}

export function getItemDetailHref(path: string) {
  const params = new URLSearchParams({ [RETURN_TO_PARAM]: getCurrentPathWithSearch() });
  return `${path}?${params.toString()}`;
}

export function rememberSourceScroll() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(
    getScrollStorageKey(getCurrentPathWithSearch()),
    String(window.scrollY),
  );
}

export function getReturnTo(searchParams: URLSearchParams, fallback = "/") {
  const returnTo = searchParams.get(RETURN_TO_PARAM);
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return fallback;
  return returnTo;
}

export function getItemTabHref(path: string, searchParams: URLSearchParams) {
  const returnTo = getReturnTo(searchParams, "");
  if (!returnTo) return path;
  const params = new URLSearchParams({ [RETURN_TO_PARAM]: returnTo });
  return `${path}?${params.toString()}`;
}

export function useRestoreSourceScroll(shouldRestore: boolean) {
  useEffect(() => {
    if (!shouldRestore || typeof window === "undefined") return;
    const key = getScrollStorageKey(getCurrentPathWithSearch());
    const storedScrollY = window.sessionStorage.getItem(key);
    if (storedScrollY === null) return;
    const scrollY = Number(storedScrollY);
    if (!Number.isFinite(scrollY)) return;
    window.sessionStorage.removeItem(key);
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
  }, [shouldRestore]);
}
