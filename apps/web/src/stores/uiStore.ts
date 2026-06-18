import { create } from "zustand";

interface UiState {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

function getInitialDarkMode(): boolean {
  if (typeof window !== "undefined") {
    return (
      localStorage.getItem("darkMode") === "true" ||
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }
  return false;
}

export const useUiStore = create<UiState>((set) => ({
  isDarkMode: getInitialDarkMode(),
  toggleDarkMode: () =>
    set((state) => {
      const next = !state.isDarkMode;
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
      localStorage.setItem("darkMode", String(next));
      return { isDarkMode: next };
    }),
}));

if (typeof window !== "undefined") {
  const initial = getInitialDarkMode();
  document.documentElement.setAttribute("data-theme", initial ? "dark" : "light");
}
