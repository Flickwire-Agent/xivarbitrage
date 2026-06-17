import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

const OpportunitiesPage = lazy(() =>
  import("./components/OpportunitiesPage.js").then((m) => ({ default: m.OpportunitiesPage })),
);
const ItemPage = lazy(() =>
  import("./components/ItemPage.js").then((m) => ({ default: m.ItemPage })),
);

function PageFallback() {
  return <div className="notice">Loading...</div>;
}

export function App() {
  return (
    <main className="appShell">
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<OpportunitiesPage />} />
          <Route path="/items/:itemId" element={<ItemPage />} />
        </Routes>
      </Suspense>
    </main>
  );
}
