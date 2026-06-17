# XIVArbitrage Development Guide

A comprehensive guide for developers and AI agents working on the XIVArbitrage project.

---

## Project Overview

**XIVArbitrage** is a TypeScript monorepo that identifies profitable arbitrage opportunities in the Final Fantasy XIV in-game market by monitoring price differences across worlds.

### Key Characteristics

- **Monorepo**: Multiple interconnected packages in a single repository
- **Full-Stack**: Backend API, Frontend UI, Shared types
- **Real-Time Data**: Evaluates ~10,000+ market items across 3 regions continuously
- **Distributed Processing**: Background worker system using BullMQ job queue
- **Persistent Storage**: PostgreSQL for market data history
- **Cloud Native**: Designed for Railway deployment

---

## Project Structure

```
XIVArbitrage/
├── apps/
│   ├── api/                          # Express/Fastify backend server
│   │   ├── src/
│   │   │   ├── config.ts             # Environment configuration
│   │   │   ├── server.ts             # Server initialization + worker setup
│   │   │   ├── routes/
│   │   │   │   └── opportunities.ts  # API endpoints
│   │   │   ├── services/
│   │   │   │   ├── arbitrage.ts      # Core arbitrage logic (now DB-based)
│   │   │   │   ├── arbitrageCache.ts # In-memory cache management
│   │   │   │   ├── universalis.ts    # Universalis API client
│   │   │   │   ├── xivapi.ts         # XIVAPI client (item details)
│   │   │   │   ├── worldCatalog.ts   # World/datacenter management
│   │   │   │   ├── rateLimiter.ts    # API rate limiting
│   │   │   │   ├── marketSnapshotStore.ts # PostgreSQL persistence
│   │   │   │   ├── jobQueue.ts       # BullMQ queue management (NEW)
│   │   │   │   ├── jobScheduler.ts   # Job distribution logic (NEW)
│   │   │   │   └── opportunityWorker.ts # Background job processor (NEW)
│   │   │   ├── data/
│   │   │   │   └── worlds.ts         # Fallback world data
│   │   │   └── db/
│   │   │       └── migrations.ts     # Database schema (NEW)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                          # Vite + React frontend
│       ├── src/
│       │   ├── App.tsx               # Main app component
│       │   ├── components/
│       │   │   ├── OpportunityTable.tsx
│       │   │   └── SelectField.tsx
│       │   └── styles.css
│       ├── vite.config.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   └── shared/                       # Shared TypeScript types
│       ├── src/
│       │   └── index.ts              # Exported interfaces & types
│       ├── package.json
│       └── tsconfig.json
│
├── railway.json                      # Railway deployment config (PostgreSQL + Redis)
├── pnpm-workspace.yaml              # Monorepo workspace definition
├── tsconfig.base.json               # Root TypeScript config
├── package.json                     # Workspace root
├── pnpm-lock.yaml                   # Locked dependencies
│
├── IMPLEMENTATION.md                # Detailed technical documentation (NEW)
├── QUICK_REFERENCE.md              # Quick deployment guide (NEW)
├── DEPLOYMENT_READY.md             # Deployment instructions (NEW)
└── README.md                         # Project overview

```

### Directory Functions

| Directory               | Purpose              | Key Files                             |
| ----------------------- | -------------------- | ------------------------------------- |
| `apps/api`              | Backend server       | `server.ts`, `services/*`, `routes/*` |
| `apps/web`              | Frontend application | `App.tsx`, `components/*`             |
| `packages/shared`       | Shared types         | `index.ts` (interfaces)               |
| `apps/api/src/db`       | Database layer       | `migrations.ts`                       |
| `apps/api/src/services` | Business logic       | `arbitrage.ts`, `jobQueue.ts`, etc.   |

---

## Tech Stack

### Core Technologies

- **Language**: TypeScript 5.7+
- **Runtime**: Node.js 22+
- **Package Manager**: pnpm 9+

### Backend

- **Framework**: Fastify 5.2 (lightweight, performant HTTP server)
- **Database**: PostgreSQL 16 (market snapshots, job history)
- **Cache**: Redis 7 (job queue storage)
- **Job Queue**: BullMQ 5.4 (distributed job processing)
- **API Client**: Node.js `fetch()` (Universalis, XIVAPI)
- **Validation**: Zod 3.24 (schema validation)
- **Driver**: pg 8.13 (PostgreSQL client)

### Frontend

- **Framework**: React (UI components)
- **Build Tool**: Vite 6 (fast bundling)
- **Styling**: Plain CSS (simple, maintainable)

### Development

- **Type Checking**: TypeScript 5.7
- **Build System**: tsc (TypeScript compiler)
- **Dev Server**: tsx (TypeScript executor)

### Infrastructure

- **Hosting**: Railway.app (cloud platform)
- **Build**: NIXPACKS (Railway's build system)
- **CI/CD**: Automatic on git push

---

## Development Setup

### Prerequisites

```bash
# Required
Node.js 22+
pnpm 9+

# Optional
PostgreSQL (for local testing)
Redis (for local job queue testing)
```

### Installation

```bash
# Install dependencies (all workspaces)
pnpm install

# This also creates node_modules at workspace root and each app
```

### Environment Configuration

Create `.env.local` in `apps/api/` (git-ignored):

```env
# Optional - leave unset for in-memory only
DATABASE_URL=postgresql://user:pass@localhost:5432/arbitrage
REDIS_URL=redis://localhost:6379

# API Configuration
PORT=4000
ARBITRAGE_REFRESH_MINUTES=15
JOB_QUEUE_CONCURRENCY=4
UNIVERSALIS_REQS_PER_SECOND=20
```

### Running Locally

```bash
# Development mode with hot reload
cd apps/api
pnpm dev

# In another terminal: frontend
cd apps/web
pnpm dev

# Production build
pnpm build

# Production start
cd apps/api
pnpm start
```

---

## Key Architectural Patterns

### 1. Service Singletons

Services are exported as singletons to ensure single instances:

```typescript
// services/universalis.ts
export const universalis = new UniversalisClient();

// Usage in other files
import { universalis } from "./services/universalis.js";
```

**Why**: Prevents multiple instances of expensive resources (connection pools, rate limiters, caches).

### 2. Rate Limiting

All Universalis API calls go through the rate limiter:

```typescript
// services/rateLimiter.ts
export const rateLimiter = new RateLimiter(20); // 20 req/sec

// Usage
await rateLimiter.schedule(() => universalis.getCurrentData(region, itemId));
```

**Why**: Universalis enforces 20 req/sec; exceeding causes 429 errors.

### 3. Database Abstraction

`marketSnapshotStore` handles all DB interactions:

```typescript
// services/marketSnapshotStore.ts
await marketSnapshotStore.upsert(region, itemId, data);
const fresh = await marketSnapshotStore.getFresh(region, itemId);
```

**Why**: Single responsibility, easier mocking for tests.

### 4. Job Queue Pattern (NEW)

Background work uses BullMQ for resilience:

```typescript
// services/jobQueue.ts
const queue = getQueue();
await queue.add("evaluate-item", { itemId, region }, { delay: 1000 });

// services/opportunityWorker.ts
const worker = new Worker("arbitrage-opportunities", async (job) => {
  // Process job with retries built-in
});
```

**Why**: Decouples long-running tasks, enables retry logic, provides progress tracking.

### 5. Configuration Through Environment

All config via `config.ts`:

```typescript
// config.ts
export const config = {
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jobQueueConcurrency: Number(process.env.JOB_QUEUE_CONCURRENCY ?? 4),
};

// Usage
if (config.databaseUrl) {
  /* enable DB */
}
```

**Why**: Enables local development without services, easy Railway deployment.

### 6. Cache-Then-Query Pattern

API requests hit in-memory cache first:

```typescript
// arbitrageCache.ts
async get(filters) {
  if (this.latest.length === 0) await this.refresh(); // Cold start
  return this.service.createResponse(this.latest, filters);
}

// Refresh every 15 minutes from database
setInterval(() => this.refresh(), 15 * 60 * 1000);
```

**Why**: Fast responses (<50ms) while background worker updates DB.

---

## Data Flow

### Startup Flow

```
Server Start
  ↓
Run Migrations (create tables if needed)
  ↓
Initialize Redis Queue
  ↓
Initialize Background Worker
  ↓
Seed marketable_items table (if empty)
  ↓
Generate 30,000 jobs (24-hour distribution)
  ↓
Start API server
  ↓
Every 6 hours: reschedule remaining items
```

### API Request Flow

```
GET /api/opportunities
  ↓
ArbitrageCache.get(filters)
  ↓
If cache empty or stale:
  Query marketable_items joined with market_snapshots
  Aggregate price data per item
  Calculate arbitrage scores
  Store in in-memory cache
  ↓
Apply filters + sort
  ↓
Return JSON response
```

### Background Job Flow

```
BullMQ Worker picks job: { itemId, region }
  ↓
RateLimiter.schedule()
  → Universalis.getCurrentData(region, itemId)
  ↓
MarketSnapshotStore.upsert(region, itemId, data)
  ↓
UPDATE marketable_items SET last_scanned = now()
  ↓
INSERT INTO job_history (success/error)
  ↓
Job completes or retries (3 attempts max)
```

---

## Important Conventions

### 1. Import Extensions

Always use `.js` extensions in imports:

```typescript
import { config } from "../config.js"; // ✅ Correct
import { config } from "../config"; // ❌ Won't work (ES modules)
```

**Why**: TypeScript with `"module": "esnext"` requires explicit extensions.

### 2. Error Handling

Wrap async operations in try-catch:

```typescript
try {
  await database.query(sql);
} catch (error) {
  console.error(`Operation failed: ${error instanceof Error ? error.message : String(error)}`);
  // Re-throw or handle gracefully
}
```

**Why**: Prevents unhandled promise rejections.

### 3. Type Safety

Use TypeScript generics for database queries:

```typescript
interface SnapshotRow {
  item_id: number;
  data: UniversalisMarketData;
}

const result = await pool.query<SnapshotRow>(`SELECT ... FROM market_snapshots`);
const itemId = result.rows[0].item_id; // Typed!
```

**Why**: Compile-time safety, IDE autocomplete.

### 4. Resource Cleanup

Close connections on graceful shutdown:

```typescript
process.on("SIGTERM", async () => {
  await closeWorker();
  await closeQueue();
  await database.end();
  process.exit(0);
});
```

**Why**: Prevents connection leaks, ensures clean Railway deployments.

### 5. Logging Patterns

Use prefixes for categorization:

```typescript
console.log("[JobScheduler] Scheduling jobs...");
console.error("[Worker] Failed item_id=12345: Network timeout");
console.warn("[BullMQ] Job 57d8a54 stalled");
```

**Why**: Easier log filtering in production.

---

## API Endpoints

### Public Endpoints

#### `GET /api/health`

Check database and Redis connectivity.

```json
{ "ok": true, "database": true, "redis": true }
```

#### `GET /api/opportunities`

Get arbitrage opportunities (filtered & sorted).

```
Query parameters:
  ?limit=50              # Results per page (default: 50, max: 500)
  ?sort=best|spread|volume|velocity  # Sort metric (default: best)
  ?highWorld=Gilgamesh   # Filter by selling world
  ?category=Weapon       # Filter by item category
  ?minSpread=500         # Minimum price difference
  ?includeHistory=true   # Include 7-day price trends
  ?refresh=true          # Force cache refresh

Response:
{
  "generatedAt": "2026-06-07T20:15:30Z",
  "opportunities": [
    {
      "itemId": 12345,
      "item": { "name": "Potions", "category": "Potions" },
      "low": { "worldName": "Gilgamesh", "pricePerUnit": 100 },
      "high": { "worldName": "Excalibur", "pricePerUnit": 150 },
      "spread": 50,
      "spreadPercent": 50.0,
      "profitScore": 5000,
      "recentSales": 100,
      "history": [  # Only if ?includeHistory=true
        { "timestamp": "...", "price": 120 },
        ...
      ]
    }
  ],
  "worlds": ["Excalibur", "Gilgamesh", ...],
  "dataCenters": ["Crystal", "Primal", ...],
  "categories": ["Armor", "Materials", ...]
}
```

#### `GET /api/worker/status`

Monitor background worker progress.

```json
{
  "queue": {
    "pending": 28500,
    "active": 4,
    "completed": 1496,
    "failed": 0,
    "delayed": 0
  },
  "items": {
    "total": 10000,
    "scanned": 1500,
    "progress": "15.00%"
  },
  "jobs24h": {
    "completed": 1496,
    "failed": 0
  },
  "lastFullScan": "2026-06-07T20:15:30Z"
}
```

---

## Database Schema

### marketable_items

Tracks all ~10,000 tradeable items and scan status.

```sql
CREATE TABLE marketable_items (
  item_id integer PRIMARY KEY,
  last_scanned timestamptz,
  priority integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Indexes**:

- `(last_scanned NULLS FIRST)` – Find unscanned items first

**Usage**: Job scheduler queries this to find items needing evaluation.

### market_snapshots

All market data for all items, all regions.

```sql
CREATE TABLE market_snapshots (
  item_id integer NOT NULL,
  region text NOT NULL,
  data jsonb NOT NULL,           -- Full Universalis response
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, region)
);
```

**Indexes**:

- `(item_id, fetched_at DESC)` – Fast aggregation per item
- `(fetched_at)` – Cleanup old records

**Usage**: Arbitrage evaluation queries this to compute opportunities.

### job_history

Complete audit trail of all background jobs.

```sql
CREATE TABLE job_history (
  id serial PRIMARY KEY,
  job_id text NOT NULL,
  item_id integer NOT NULL,
  region text NOT NULL,
  status text NOT NULL,         -- 'completed' or 'failed'
  error_message text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Indexes**:

- `(status, completed_at DESC)` – Query recent jobs

**Usage**: Monitoring, debugging, retry logic.

---

## Testing Strategy

### What's Tested

- ✅ TypeScript compilation
- ✅ API endpoints (manual via curl)
- ✅ Database migrations (auto on startup)
- ✅ Worker job processing (via logs)

### How to Test Locally

```bash
# 1. Type checking
pnpm build

# 2. Start services (if available)
# postgres & redis required for full testing

# 3. Run API
cd apps/api
pnpm dev

# 4. Query endpoints
curl http://localhost:4000/api/health
curl http://localhost:4000/api/opportunities
curl http://localhost:4000/api/worker/status

# 5. Check logs
# [Worker] messages indicate job processing
# [ArbitrageCache] messages indicate cache refreshes
# [JobScheduler] messages indicate job queueing
```

### Load Testing

Simulating high load (manual):

```bash
# In a loop
for i in {1..100}; do
  curl http://localhost:4000/api/opportunities &
done
wait

# Monitor: Should see <50ms responses (cache hit)
# DB connections should stay stable
```

---

## Deployment

### To Railway

```bash
# 1. Commit changes
git add -A
git commit -m "Your changes"

# 2. Push (Railway auto-deploys)
git push

# 3. Monitor
# Railway UI → Deployments → View logs
# Check /api/health returns ok=true
# Monitor /api/worker/status for progress
```

### Environment Variables (Railway)

```
DATABASE_URL          # Auto-provided by PostgreSQL service
REDIS_URL             # Auto-provided by Redis service
JOB_QUEUE_CONCURRENCY # Optional (default: 4)
```

### Health Check

Railway polls `GET /api/health` every 30 seconds with 5-minute timeout.

```json
// Success (2xx)
{ "ok": true, "database": true, "redis": true }

// Failure (503)
{ "error": "Database: down, Redis: ok" }
```

---

## Common Development Tasks

### Add a New API Endpoint

1. Add route in `apps/api/src/routes/opportunities.ts`
2. Validate input with Zod schema
3. Call service methods
4. Return JSON response

Example:

```typescript
app.get("/api/trending", async (request) => {
  const { days } = querySchema.parse(request.query);
  const trends = await arbitrage.getTrends(days);
  return trends;
});
```

### Modify Database Schema

1. Update `apps/api/src/db/migrations.ts`
2. Add new table/index creation SQL
3. Restart API (migrations auto-run on startup)

Example:

```typescript
await pool.query(`
  CREATE TABLE IF NOT EXISTS new_table (
    id serial PRIMARY KEY,
    ...
  );
`);
```

### Add a New Service

1. Create `apps/api/src/services/myService.ts`
2. Export singleton at bottom
3. Import in files that need it

Example:

```typescript
// services/myService.ts
export class MyService {
  async doSomething() { ... }
}
export const myService = new MyService();

// Usage in other files
import { myService } from '../services/myService.js';
```

### Adjust Configuration

1. Add environment variable to `apps/api/src/config.ts`
2. Set on Railway or in `.env.local` locally
3. Use `config.myNewVar` throughout code

Example:

```typescript
export const config = {
  myNewVar: Number(process.env.MY_NEW_VAR ?? 10),
};
```

---

## Troubleshooting

### Build Failures

```bash
# Clear cache and rebuild
rm -rf dist node_modules
pnpm install
pnpm build
```

### TypeScript Errors

```bash
# Check type errors
pnpm build

# Usually from:
# - Missing .js extensions in imports
# - Type mismatches in database queries
# - Outdated type definitions
```

### Database Connection Issues

```bash
# Verify connection string
echo $DATABASE_URL

# Check PostgreSQL is running
psql $DATABASE_URL -c "SELECT NOW();"

# Check migrations ran
psql $DATABASE_URL -c "SELECT * FROM information_schema.tables WHERE table_name='market_snapshots';"
```

### Redis Connection Issues

```bash
# Verify connection string
echo $REDIS_URL

# Test connection
redis-cli -u $REDIS_URL ping
# Should return: PONG
```

### No Opportunities Returned

1. Check `/api/health` returns ok
2. Check `/api/worker/status` shows progress
3. Wait 30+ minutes for first job batch
4. Check `job_history` table for errors

---

## Performance Considerations

### Memory Usage

- **In-memory cache**: ~50MB for 10k opportunities
- **Worker concurrency**: 4 concurrent jobs (tunable)
- **Redis connection pool**: Minimal

**Optimization**:

```env
JOB_QUEUE_CONCURRENCY=2    # Lower memory usage
ARBITRAGE_REFRESH_MINUTES=30 # Refresh less frequently
```

### Database Performance

- **Row count**: ~400k at steady state (10k items × 3 regions × 14 days)
- **Query time**: <100ms for full scan
- **Write throughput**: ~1-10 writes/sec

**Optimization**: Indexes on (item_id, fetched_at) and (status).

### API Response Times

- **Cached**: <50ms (in-memory)
- **Uncached (cold start)**: <1s (database query)
- **With history**: <500ms (7-day aggregation)

---

## Future Development

### Known Limitations

1. Rolling evaluation not yet implemented (only daily full scans)
2. No user-specific watchlists
3. No price prediction/forecasting
4. Single-region limitations not addressed

### Potential Improvements

1. Incremental scanning (update popular items more frequently)
2. User authentication and preferences
3. Price trend analysis and predictions
4. Slack/Discord notifications for opportunities
5. Mobile app
6. WebSocket real-time updates

### Code Organization Tips

- Keep services pure (single responsibility)
- Use dependency injection for testability
- Favor composition over inheritance
- Document complex algorithms with comments
- Use TypeScript strict mode (already enabled)

---

## Resources

### Internal Documentation

- [IMPLEMENTATION.md](IMPLEMENTATION.md) – Technical deep dive
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) – Command reference
- [DEPLOYMENT_READY.md](DEPLOYMENT_READY.md) – Deployment guide

### External Resources

- [Universalis API](https://universalis.app/docs/api)
- [XIVAPI](https://v2.xivapi.com/api)
- [BullMQ Docs](https://docs.bullmq.io/)
- [Railway Docs](https://docs.railway.app/)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)
- [Fastify Docs](https://www.fastify.io/)

---

## Summary

XIVArbitrage is a well-structured TypeScript monorepo with clear separation of concerns:

- **Backend**: Fastify API + background worker
- **Frontend**: React UI
- **Shared**: Common types
- **Infrastructure**: Railway (PostgreSQL + Redis)

The codebase follows modern TypeScript practices with strict typing, proper error handling, and clean architecture. The distributed job system enables scaling from 250 to 10,000+ items while maintaining responsiveness.

For agents working on this codebase, focus on:

1. Following the existing patterns (singletons, rate limiting, error handling)
2. Respecting environment configuration
3. Maintaining TypeScript types throughout
4. Adding proper logging for observability
5. Testing changes locally before deployment
