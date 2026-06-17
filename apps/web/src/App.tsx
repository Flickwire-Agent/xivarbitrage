import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

const OpportunitiesPage = lazy(() =>
  import("./components/OpportunitiesPage.js").then((m) => ({ default: m.OpportunitiesPage })),
);
const ItemPage = lazy(() =>
  import("./components/ItemPage.js").then((m) => ({ default: m.ItemPage })),
);
const ListingsPage = lazy(() =>
  import("./components/ListingsPage.js").then((m) => ({ default: m.ListingsPage })),
);
const BargainsPage = lazy(() =>
  import("./components/BargainsPage.js").then((m) => ({ default: m.BargainsPage })),
);

function PageFallback() {
  return (
    <div className="notice" role="status" aria-live="polite">
      Loading...
    </div>
  );
}

export function App() {
  return (
    <>
      <a
        href="#main-content"
        className="srOnly"
        style={{ position: "absolute", top: 0, left: 0, zIndex: 9999 }}
      >
        Skip to main content
      </a>
      <main className="appShell" id="main-content" aria-label="XIV Arbitrage application">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<OpportunitiesPage />} />
            <Route path="/bargains" element={<BargainsPage />} />
            <Route path="/items/:itemId" element={<ItemPage />} />
            <Route path="/items/:itemId/listings" element={<ListingsPage />} />
          </Routes>
        </Suspense>
      </main>
    </>
  );
}
