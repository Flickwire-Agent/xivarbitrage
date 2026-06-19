# Agent Workspace Memory

## System

- **OS**: Ubuntu 26.04 LTS (Resolute Raccoon) / Linux 7.0.0-22-generic x86_64
- **Kernel**: 7.0.0-22-generic
- **CPU**: 4 cores
- **RAM**: ~8GB
- **Disk**: ~157GB (147GB free)
- **Shell**: zsh + starship prompt

## Pre-installed Tools

- `git`, `curl`, `wget`, `jq`, `tmux`, `zsh`, `python3` (3.14.6), `apt`
- `opencode` binary at `~/.opencode/bin/opencode` (in PATH)

## Package Managers

- **Homebrew** at `/home/linuxbrew/.linuxbrew` — preferred for agentic tool installs
- **apt** (system) — use only when brew doesn't have a formula

## Install History

- `ripgrep` 14.1.1 - static binary to `~/.local/bin`
- `fzf` 0.62.0 - static binary to `~/.local/bin`
- `bat` 0.25.0 - static binary to `~/.local/bin`
- `eza` 0.20.24 - static binary to `~/.local/bin`
- `lazygit` 0.50.0 - static binary to `~/.local/bin`
- `gh` (GitHub CLI) 2.75.0 - static binary to `~/.local/bin`
- `Node.js` 24.16.0 (Latest LTS: Krypton) via nvm (v0.40.4)
- `pnpm` 11.7.0 - global npm package
- `tsx` 4.22.4 - global npm package
- `Go` 1.26.4 - via Homebrew
- `Rust` 1.96.0 - via Homebrew
- `pip` 26.1.2 - `pip3 install --user`
- `pipx` 1.14.0 - Python package
- `ruff` 0.15.17 - Python package
- `black` 26.5.1 - Python package
- `TypeScript` 6.0.3 - latest via `npm -g`
- `oxlint` 1.70.0 - JavaScript/TypeScript linter via `npm -g`
- `oxfmt` 0.55.0 - JavaScript/TypeScript formatter via `npm -g`
- `neovim` 0.12.3 - modern vim editor via Homebrew
- `fd` 10.4.2 - fast file finder via Homebrew
- `delta` 0.19.2 - syntax-highlighted git diffs via Homebrew
- `zoxide` 0.9.9 - smarter cd via Homebrew (alias `j`)
- `btop` 1.4.7 - system monitor via Homebrew

## Language Conventions

- **JavaScript/TypeScript**: Use pnpm for all npm packages. Write all new projects in TypeScript.
- **TypeScript tools**: Use `oxlint` (linter) and `oxfmt` (formatter) with default config.
- **pnpm security**: Global config enforces `engine-strict=true`, `save-prefix=~`, `minimumReleaseAge=10080` (7 days in minutes).
- **TypeScript version**: Always use the latest stable TypeScript (currently 6.0.3).
- **New TS projects**: Configure husky with pre-commit hooks for oxlint and oxfmt
  - `pnpm add -D husky oxlint && pnpm pkg set scripts.prepare="husky" && pnpm run prepare`
  - `echo "oxlint ." > .husky/pre-commit && echo "oxfmt --check ." >> .husky/pre-commit`
- **All repos**: Commit messages must follow Conventional Commits. The dotfiles repo provides a global `commit-msg` hook at `~/.githooks/commit-msg` (set via `core.hooksPath`). For TS repos with husky, add commitlint as well.

## GitHub

- **Account**: `Flickwire-Agent` (agent@blueskye.co.uk)
- **Auth**: gh CLI authenticated, SSH protocol
- **SSH key**: `~/.ssh/id_ed25519` — added to GitHub for auth + signing
- **SSH host**: `github.com` configured in `~/.ssh/config`
- **Collaborators**: Always add `Flickwire` as a collaborator with admin access when creating new repos (`gh api repos/<owner>/<repo>/collaborators/Flickwire -X PUT -f permission=admin`)
- **README rule**: Every new repo must get a descriptive README before the first push. Write it right after `git init` and `git add`, before `git commit`.

## Git Configuration

- **Protocol**: SSH (via `gh config set git_protocol ssh`)
- **Commit signing**: Enabled with SSH key (`~/.ssh/id_ed25519.pub`)
  - `gpg.format = ssh`, `commit.gpgsign = true`
  - All commits are signed automatically
- **Commit convention**: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
  - Format: `<type>(<scope>): <description>`
  - Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `build`

## OpenCode Configuration

- Config file: `~/.config/opencode/opencode.jsonc`
- Plugins: `@opencode-ai/plugin` (pnpm-based)
- Custom bin: `~/.opencode/bin/`

## Agent Lessons

- **Fail early, ask for help**: If you've spent more than a few minutes brute-forcing a solution, stop and ask the user.
- **Sync dotfiles**: Whenever you modify machine config files (`~/.config/`, `~/.zshrc`, etc.), immediately mirror the changes to `~/dotfiles/` and symlink from the original location.
- **Push dotfiles to GitHub**: After editing files in `~/dotfiles/`, commit and push to GitHub automatically.
- **Validate opencode config**: After editing any opencode JSONC config, validate it before the user restarts. Fetch the schema from `https://opencode.ai/config.json` and run a structural comparison.
- **Commit early and often**: Stage related changes together, use `git add -p` to split hunks across commits when needed.

## Scheduled Tasks

- **Daily update**: `topgrade --yes` via cron at 6:00 AM daily (`crontab -l` to view)

## Common Tasks

- **Code search**: `rg` (ripgrep) - static binary to `~/.local/bin`
- **File search**: `fzf` - static binary to `~/.local/bin`
- **Package install**: `sudo apt install -y <package>`
- **Node.js management**: nvm at `~/.nvm/nvm.sh`
- **Python packages**: `pip3` or `python3 -m pip`

---

# Project: xiv-arbitrage

## Overview

pnpm workspace monorepo for finding FFXIV item arbitrage opportunities across worlds and data centers. ~10,000 marketable items evaluated across 3 regions (NA, EU, OCE) in a 24-hour cycle.

## Production

- **Process**: pm2 manages `xivarbitrage` (runs `apps/api/dist/server.js`)
- **After API update**: `pnpm run -r --filter=@xiv-arbitrage/api build` then `pm2 restart xivarbitrage`
- **After web update**: `pnpm run -r --filter=@xiv-arbitrage/web build` (served statically by API)
- **Redeploy rule**: After ANY build step, always run `pm2 restart xivarbitrage` to redeploy. This applies to both API and web builds since the API serves the web statically.
- **Host**: Railway.app (alternative), auto-deploys on `git push`
- **Health**: `GET /api/health` returns `{ ok, database, redis }`
- **Worker status**: `GET /api/worker/status` shows queue depth, completion %, 24h stats

## Project Structure

```
apps/
  api/            Fastify API — market data ingestion, arbitrage logic, BullMQ worker
    src/
      config.ts, server.ts
      routes/opportunities.ts
      services/
        arbitrage.ts, arbitrageCache.ts
        universalis.ts, xivapi.ts, rateLimiter.ts
        marketSnapshotStore.ts  (PostgreSQL persistence)
        jobQueue.ts, jobScheduler.ts, opportunityWorker.ts  (BullMQ)
      db/migrations.ts
      data/worlds.ts
  web/            React SPA (Vite) — DC disparities, bargains, item history
    src/
      App.tsx, styles.css
      components/  (DcDisparitiesPage, BargainsPage, ItemPage, ListingsPage, SaleHistoryView, SaleHistoryChart, SearchBox, SelectField)
packages/
  shared/         Shared TypeScript types (ItemHistoryResponse, ListingsResponse, etc.)
```

## Tech Stack

- **Runtime**: Node.js 24.16, TypeScript 6.0.3
- **Backend**: Fastify 5, pg (PostgreSQL), ioredis (Redis), BullMQ 5
- **Frontend**: React 19, react-router-dom v7, Vite 6, Recharts 2
- **Data**: PostgreSQL 16, Redis 7
- **Build**: tsc, pnpm workspaces, esbuild (via Vite)

## Environment Variables

```
PORT=4000
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JOB_QUEUE_CONCURRENCY=4
ARBITRAGE_REFRESH_MINUTES=15
UNIVERSALIS_BASE_URL=https://universalis.app/api/v2
XIVAPI_BASE_URL=https://v2.xivapi.com/api
UNIVERSALIS_REQS_PER_SECOND=20
XIVAPI_API_KEY=
MARKET_SNAPSHOT_RETENTION_DAYS=14
ARBITRAGE_ITEM_LIMIT=80
ARBITRAGE_MAX_CONCURRENCY=4
```

## API Endpoints

### `GET /api/dc-disparities`

DC average price disparities across all marketable items (cached, refreshed every 15 min).
Query params: `?highDc=X&lowDc=X&region=X&sort=spread|spreadPercent&minSpread=1000`
Returns all items from `marketable_items` — items without sale data show as "No sale data".

### `GET /api/bargains`

Items with current listings priced ≥20% below global IQR average price (cached, refreshed every 15 min).
DC average comparison was removed — now uses global IQR average exclusively.
Top 200 discounts, paginated. Query params: `?page=1&perPage=50`

### `GET /api/health`

`{ ok, database, redis }`

### `GET /api/worker/status`

`{ queue: { pending, active, completed, failed }, items: { total, scanned, progress }, jobs24h: { completed, failed } }`

### `GET /api/items/:itemId/history`

Sale history for an item, with DC daily averages and world data center mappings.

### `GET /api/items/:itemId/listings`

Current marketboard listings priced below DC IQR average, sorted by discount %.

## Database Schema

- **marketable_items**: `(item_id PK, last_scanned, priority)` — tracks ~10k tradeable items
- **market_snapshots**: `(item_id, region, data jsonb, fetched_at PK composite)` — full Universalis responses
- **sale_history**: `(id, item_id, world_id, price_per_unit, quantity, timestamp)` — individual sale records
- **job_history**: `(id, job_id, item_id, region, status, error_message, completed_at)` — audit trail
- **dc_item_averages**: `(item_id, data_center PK, avg_price, sale_count, computed_at)` — IQR-filtered DC averages, recomputed hourly

## Key Architectural Patterns

- **Service singletons**: Exported instances (universalis, rateLimiter, marketSnapshotStore)
- **Rate limiting**: Token-bucket (default 20 req/s) wraps all Universalis calls
- **Cache-then-query**: In-memory cache refreshed every 15 min from DB; <50ms response
- **Job queue**: BullMQ distributes 30,000 jobs (10k items × 3 regions) over 24h; 4 concurrent workers, 3 retries with exponential backoff
- **Import extensions**: Always use `.js` extensions in TS imports (ESM requirement)
- **Logging prefixes**: `[Worker]`, `[JobScheduler]`, `[BullMQ]`, `[BargainsCache]`, `[DcDisparityCache]`

## Conventions

- **Cite files as `path:line`** when referencing code
- **Commit types**: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `build`
- **PR workflow**: All changes go through PRs against `main`. PRs must describe what changed and why.

## Development Setup

```bash
pnpm install
# API dev: cd apps/api && pnpm dev  (port 4000)
# Web dev: cd apps/web && pnpm dev  (port 5173)
pnpm run -r --filter=@xiv-arbitrage/api build  # production build
pnpm run -r --filter=@xiv-arbitrage/web build
```

## Marketing & Visibility

- **Xiv-resources**: Listed at `https://github.com/karashiiro/xiv-resources` in both "Web Applications" and "Web APIs" sections. PR was created at `https://github.com/karashiiro/xiv-resources/pull/32`. To update the listing, fork the repo, edit `README.md`, and open a new PR.
- **GitHub topics**: Set to `ffxiv`, `market-board`, `universalis`, `arbitrage`, `ffxiv-tool`, `final-fantasy-xiv`.
- **OG image**: Dynamically server-generated via Sharp + SVG at `/api/og/disparities` (top 5 disparities), `/api/og/bargains` (top 5 bargains), and `/api/og/items/:itemId` (item icon + stats). The SVG templates live in `apps/api/src/services/ogGenerator.ts`. Images are cached in-memory for 15 min. Set `og:image` in `index.html` to the dynamic endpoint.
- **Favicon**: Generated from OG image. Served as 512x512, 192x192 (PWA), and 32x32 (favicon). Declared in `index.html` and `manifest.json`.
- **Sitemap**: `apps/web/public/sitemap.xml` — lists `/` and `/bargains`. The incorrect `/dc-disparities` entry was removed (that route doesn't exist).
- **Analytics**: Plausible (EU-based, privacy-friendly, no cookies). Controlled by `VITE_PLAUSIBLE_DOMAIN` env var. Set at build time. Loads dynamically via `apps/web/src/lib/analytics.ts` only in production when the env var is set.
- **API analytics**: Built-in `apiUsageMonitor` service records every API request (IP, endpoint, status code, response time, user agent, origin) in Redis with hourly bucketing and 7-day retention. Exposed at `GET /api/monitoring/usage?hours=24` returning total requests, unique consumers, top endpoints, status codes, and response time distribution.

## Recommissioning

If reactivating this project after a gap, check:

1. `pm2 status` — restart `xivarbitrage` if needed
2. `pnpm build` — recheck build works with current toolchain
3. Redis and PostgreSQL are running
4. The Universalis API rate limit hasn't changed
5. GitHub topics are still set on the repo
6. xiv-resources PR was accepted (check https://github.com/karashiiro/xiv-resources/pull/32)

## Key Concepts

- **Arbitrage spread**: Low side = cheapest current listing (buy price); High side = highest recent _sold_ price (actual transactions, not listings)
- **Universalis timestamps**: API returns seconds; `new Date(s * 1000)` required
- **Routing**: wouter with URL search params for filters; lazy-loaded chunks (shell 236 kB, disparities list 8 kB, detail 373 kB, listings 4 kB, bargains 4 kB)
- **Disparities page** (`/`): DC average price disparities across all ~10k `marketable_items`, sorted by spread descending. Items without sale data show "No sale data". Items available in only one DC show its price without a disparity. Uses IQR-filtered DC averages from `dc_item_averages` table with minimum 1 sale per DC.
- **Bargains page** (`/bargains`): items with current listings priced ≥20% below global IQR average price. Uses global IQR average exclusively (not per-DC average). Refreshed every 15 min, returns top 200.
- **DC average lines**: `ComposedChart` with scatter (world sales) + Line (DC daily avg)
