import { lazy, Suspense, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { SearchBox } from "./components/SearchBox.js";

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
const ONBOARDING_STORAGE_KEY = "xiv-arbitrage.onboarding-dismissed";

function hasDismissedOnboarding() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "true";
}

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
  const [isExplainerOpen, setIsExplainerOpen] = useState(false);
  const [isOnboardingDismissed, setIsOnboardingDismissed] = useState(hasDismissedOnboarding);

  function isActive(path: string) {
    if (path === "/") return location === "/";
    return location.startsWith(path);
  }

  function dismissOnboarding() {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    setIsOnboardingDismissed(true);
  }

  return (
    <>
      <a href="#main-content" className="skipLink">
        Skip to main content
      </a>
      <main
        className="appShell"
        id="main-content"
        tabIndex={-1}
        aria-label="XIV Arbitrage application"
      >
        <div className="mainNavigation">
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
          <div className="appSearch">
            <SearchBox />
          </div>
          <button
            type="button"
            className={`helpButton${isExplainerOpen ? " active" : ""}`}
            onClick={() => setIsExplainerOpen((open) => !open)}
            aria-expanded={isExplainerOpen}
            aria-controls="methodology-explainer"
          >
            How this works
          </button>
        </div>
        {!isOnboardingDismissed ? (
          <section className="onboardingPrompt" aria-labelledby="onboarding-title">
            <div>
              <p className="eyebrow">Before you trade</p>
              <h2 id="onboarding-title">Understand how opportunities are calculated</h2>
              <p>
                XIV Arbitrage compares current low-side listings with high-side completed sales.
                Review the terms, freshness, and risk notes before acting on market data.
              </p>
            </div>
            <div className="onboardingActions">
              <button
                type="button"
                className="iconButton"
                onClick={() => {
                  setIsExplainerOpen(true);
                  dismissOnboarding();
                }}
              >
                Read how this works
              </button>
              <button type="button" className="textButton" onClick={dismissOnboarding}>
                Dismiss
              </button>
            </div>
          </section>
        ) : null}
        {isExplainerOpen ? (
          <section
            className="methodologyExplainer"
            id="methodology-explainer"
            aria-labelledby="methodology-title"
          >
            <div className="methodologyHeader">
              <div>
                <p className="eyebrow">Methodology</p>
                <h2 id="methodology-title">How to read arbitrage opportunities</h2>
              </div>
              <button
                type="button"
                className="textButton"
                onClick={() => setIsExplainerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="methodologyGrid">
              <article>
                <h3>Gross spread</h3>
                <p>
                  The difference between the lowest buy-side price and the high-side market value
                  before fees, taxes, travel time, or relisting risk.
                </p>
              </article>
              <article>
                <h3>Net spread</h3>
                <p>
                  Your expected margin after practical costs. Treat this as a planning estimate, not
                  a guaranteed profit.
                </p>
              </article>
              <article>
                <h3>Recent sales</h3>
                <p>
                  High-side prices are based on completed sales, not current listings, so they
                  reflect what buyers recently paid.
                </p>
              </article>
              <article>
                <h3>Velocity</h3>
                <p>
                  Sales volume indicates how often an item moves. Slow items can tie up gil even
                  when the spread looks attractive.
                </p>
              </article>
              <article>
                <h3>Confidence and risk</h3>
                <p>
                  More recent sales across more worlds increase confidence. Thin data, old sales, or
                  one-off spikes should be treated as higher risk.
                </p>
              </article>
              <article>
                <h3>Bargains</h3>
                <p>
                  Bargains are current listings priced below the global IQR-filtered recent average,
                  useful for spotting underpriced items quickly.
                </p>
              </article>
              <article>
                <h3>DC disparities</h3>
                <p>
                  DC disparities compare average completed-sale prices between data centers to
                  surface cross-DC price gaps.
                </p>
              </article>
              <article>
                <h3>Freshness and sources</h3>
                <p>
                  Market listings and sales come from Universalis, item details come from XIVAPI,
                  and cached views refresh periodically. Always confirm in-game before buying.
                </p>
              </article>
            </div>
          </section>
        ) : null}
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
