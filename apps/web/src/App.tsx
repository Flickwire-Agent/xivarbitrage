import { lazy, Suspense } from "react";
import { Link, Route, Switch, useLocation } from "wouter";

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
    <div className="pageSkeleton" role="status" aria-live="polite" aria-label="Loading page">
      <section className="topBar skeletonTopBar" aria-hidden="true">
        <div>
          <p className="eyebrow skeletonLine skeletonEyebrow" />
          <div className="skeletonTitle" />
        </div>
        <div className="skeletonSearch" />
        <div className="skeletonButton" />
      </section>
      <section className="metricStrip skeletonMetrics" aria-hidden="true">
        <article />
        <article />
        <article />
      </section>
      <section className="toolbar skeletonToolbar" aria-hidden="true">
        <div />
        <div />
        <div />
        <div />
        <div />
      </section>
      <div className="tableShell skeletonTable" aria-hidden="true" />
    </div>
  );
}

export function App() {
  const [location] = useLocation();

  function isActive(path: string) {
    if (path === "/") return location === "/";
    return location.startsWith(path);
  }

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
        <nav className="mainTabs" aria-label="Main views">
          <Link
            href="/"
            className={`mainTab${isActive("/") ? " active" : ""}`}
            aria-current={isActive("/") ? "page" : undefined}
          >
            Disparities
          </Link>
          <Link
            href="/bargains"
            className={`mainTab${isActive("/bargains") ? " active" : ""}`}
            aria-current={isActive("/bargains") ? "page" : undefined}
          >
            Bargains
          </Link>
        </nav>
        <div className="routeFrame">
          <Suspense fallback={<PageFallback />}>
            <Switch>
              <Route path="/" component={DcDisparitiesPage} />
              <Route path="/bargains" component={BargainsPage} />
              <Route path="/items/:itemId/listings" component={ListingsPage} />
              <Route path="/items/:itemId" component={ItemPage} />
              <Route component={DcDisparitiesPage} />
            </Switch>
          </Suspense>
        </div>
      </main>
      <footer className="appFooter">
        <div className="appFooterInner">
          <div className="appFooterBrand">
            <span>XIV Arbitrage</span>
            <span className="appFooterSeparator">&mdash;</span>
            <span>FFXIV Market Board Arbitrage Finder</span>
          </div>
          <div className="appFooterLinks">
            <a href="https://universalis.app" rel="noopener noreferrer">
              Universalis
            </a>
            <a href="https://xivapi.com" rel="noopener noreferrer">
              XIVAPI
            </a>
            <a href="/api/dc-disparities">API</a>
            <a href="/llms.txt">AI Docs</a>
            <a
              href="https://github.com/Flickwire-Agent/xivarbitrage"
              target="_blank"
              rel="noopener noreferrer"
              className="appFooterGithub"
              aria-label="View source on GitHub"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span>GitHub</span>
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}
