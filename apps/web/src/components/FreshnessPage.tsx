import type { FreshnessState } from "@xiv-arbitrage/shared";
import { useFreshnessStatus } from "../hooks/api.js";

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "No data";
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "No data";
}

function FreshnessCard({
  label,
  timestamp,
  state,
}: {
  label: string;
  timestamp: string | null;
  state: FreshnessState;
}) {
  return (
    <article className={`freshnessCard freshness-${state}`}>
      <div className="freshnessCardHeader">
        <span>{label}</span>
        <strong>{state}</strong>
      </div>
      <time dateTime={timestamp ?? undefined}>{formatTimestamp(timestamp)}</time>
    </article>
  );
}

export function FreshnessPage() {
  const { data, error, isLoading } = useFreshnessStatus();

  if (isLoading) return <div className="notice">Loading market-data status…</div>;
  if (error || !data) return <div className="notice error">Unable to load freshness status.</div>;

  return (
    <div className="freshnessPage">
      <section className="pageHeading">
        <p className="eyebrow">Operator view</p>
        <h1>Data freshness</h1>
        <p>
          Freshness is based on the oldest current snapshot and the latest successful worker
          activity.
        </p>
      </section>
      <section className="metricStrip" aria-label="API and queue health">
        <article>
          <div>
            <span>API dependencies</span>
            <strong>{data.api.database && data.api.redis ? "Healthy" : "Unavailable"}</strong>
          </div>
        </article>
        <article>
          <div>
            <span>Queue depth</span>
            <strong>{(data.queue.pending + data.queue.active).toLocaleString()}</strong>
          </div>
        </article>
        <article>
          <div>
            <span>Failed jobs retained</span>
            <strong>{data.queue.failed.toLocaleString()}</strong>
          </div>
        </article>
      </section>
      <section className="freshnessGrid" aria-label="Market data freshness">
        <FreshnessCard
          label="Oldest current snapshot"
          timestamp={data.marketData.oldestSnapshotAt}
          state={data.freshness.snapshots}
        />
        <FreshnessCard
          label="Latest worker activity"
          timestamp={data.marketData.lastWorkerActivityAt}
          state={data.freshness.worker}
        />
        <FreshnessCard
          label="Bargains cache"
          timestamp={data.caches.bargainsGeneratedAt}
          state={data.freshness.bargainsCache}
        />
        <FreshnessCard
          label="Disparities cache"
          timestamp={data.caches.dcDisparitiesGeneratedAt}
          state={data.freshness.dcDisparitiesCache}
        />
      </section>
    </div>
  );
}
