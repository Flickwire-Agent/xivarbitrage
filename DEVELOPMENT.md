# Development Guide

## Code Attribution and PR Workflow

All changes to this repository — whether authored by humans or automated agents — must go through a pull request. Direct commits to `main` are not permitted.

### Why PRs Are Required

- **Audit trail**: Every change is traceable to an author, a rationale, and a review.
- **Code review**: A second set of eyes catches bugs, regressions, and design issues before they reach production.
- **Attribution**: Automated tooling (e.g. AI coding agents) must attribute changes clearly in the PR description, including what was changed and why.

### PR Requirements

1. Open a pull request against `main` for every change, no matter how small.
2. The PR description must explain **what** changed and **why** — not just restate the diff.
3. Automated agents must identify themselves in the PR description and link to the originating task or instruction.
4. PRs must pass CI checks before merging.

## Project Structure

```
apps/
  api/        Node.js TypeScript API (Fastify) — market data ingestion and arbitrage logic
  web/        React SPA (Vite) — opportunity display and filtering
packages/
  shared/     Shared TypeScript types consumed by both apps
```

## Local Development

```bash
pnpm install
pnpm dev
```

The API runs on `http://localhost:4000` and the web app on `http://localhost:5173` by default.

## Key Concepts

### Arbitrage Calculation

The spread between worlds is calculated as:

- **Low side** — cheapest current listing price (what you pay to buy the item)
- **High side** — highest recent *sold* price on the destination world (actual transactions, not asking prices)

Using sold prices for the high side filters out unrealistic listings that inflate apparent profit margins and would never actually sell. If no recent sales data is available for a world, the calculation falls back to listing prices.

### Market Data

Market snapshots are fetched from [Universalis](https://universalis.app) and stored in PostgreSQL. The API respects the documented rate limit of 25 req/s (defaulting to 20 req/s via a token-bucket limiter). Item metadata is enriched via [XIVAPI v2](https://v2.xivapi.com).
