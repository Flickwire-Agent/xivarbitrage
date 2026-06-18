import { lazy, Suspense } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

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
const DcDisparitiesPage = lazy(() =>
  import("./components/DcDisparitiesPage.js").then((m) => ({ default: m.DcDisparitiesPage })),
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
      <nav className="srOnly" aria-label="Site navigation">
        <ul>
          <li>
            <NavLink to="/">Arbitrage Opportunities</NavLink>
          </li>
          <li>
            <NavLink to="/bargains">Market Bargains</NavLink>
          </li>
          <li>
            <NavLink to="/dc-disparities">DC Price Disparities</NavLink>
          </li>
        </ul>
      </nav>
      <main className="appShell" id="main-content" aria-label="XIV Arbitrage application">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<OpportunitiesPage />} />
            <Route path="/bargains" element={<BargainsPage />} />
            <Route path="/dc-disparities" element={<DcDisparitiesPage />} />
            <Route path="/items/:itemId" element={<ItemPage />} />
            <Route path="/items/:itemId/listings" element={<ListingsPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="srOnly">
        <p>XIV Arbitrage — FFXIV Market Board Arbitrage Finder</p>
        <p>
          Market data from{" "}
          <a href="https://universalis.app" rel="noopener noreferrer">
            Universalis
          </a>
          . Item data from{" "}
          <a href="https://xivapi.com" rel="noopener noreferrer">
            XIVAPI
          </a>
          .
        </p>
        <nav aria-label="API documentation">
          <ul>
            <li>
              <a href="/api/opportunities">Arbitrage API</a>
            </li>
            <li>
              <a href="/api/bargains">Bargains API</a>
            </li>
            <li>
              <a href="/api/dc-disparities">DC Disparities API</a>
            </li>
            <li>
              <a href="/llms.txt">AI Agent Docs</a>
            </li>
          </ul>
        </nav>
      </footer>
    </>
  );
}
