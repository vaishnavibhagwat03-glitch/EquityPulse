# EquityPulse

Real-time stock intelligence for 5,247 simulated NSE/BSE securities: a screener with 53 criteria and nested AND/OR logic, a virtualised live grid, candlestick charts with technical indicators, a watchlist and a keyboard-first command palette.

> **All market data is simulated.** Prices, fundamentals and indices are generated deterministically for each trading day and move under a live price simulator. Nothing here is investment advice.

## Quick start

Requires Node.js ≥ 20.9.

```bash
npm install
npm run dev:web        # app on http://localhost:3000, live feed runs in a Web Worker
```

To run with the real WebSocket feed server instead:

```bash
npm run dev            # feed server on ws://localhost:4001 + app on :3000
```

Production:

```bash
npm run build
npm start              # worker feed; or `npm run start:all` with the ws server
```

## What is in it

| Area                           | What it does                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Markets** (`/`)              | Market Grid: NIFTY 50, SENSEX, BANK NIFTY, NIFTY IT and four broad indices with intraday paths, market breadth and day-change distribution, sector movement, top movers, live preset counts, a stock in focus and your watchlist. First visit plays a short boot sequence (~2.5 s); later visits a ~1 s version; reduced motion gets a static frame and a fade.                     |
| **Screener** (`/screener`)     | 5,247 securities, 53 filters in four categories (range, multi-select, select, boolean, field relations), per-category and root AND/OR, a nested custom expression builder with NOT, 6 preset screens, saved screens, removable filter chips, live "showing X of Y", search, sortable/pinnable/resizable/hideable columns, keyboard navigation, live price flashes, a context panel. |
| **Stock detail** (`/[symbol]`) | Server-rendered header and metadata, live price, candlestick chart (1D/1W/1M/3M/1Y/5Y) with SMA 20/50/200, EMA 12/26, Bollinger 20/2, RSI 14 pane and volume profile; zoom, pan, crosshair OHLCV readout, reset; fundamentals in tabs (overview, financials, shareholding, technicals); peers.                                                                                      |
| **Watchlist** (`/watchlist`)   | Add, remove, live prices and changes, open detail; persisted in the browser.                                                                                                                                                                                                                                                                                                        |
| **Command palette**            | `Ctrl/⌘ K` or `/`. Search securities, open, add to watchlist (`Ctrl+Enter`), screen similar (`Shift+Enter`), apply presets, navigate, theme, help. `?` lists every shortcut.                                                                                                                                                                                                        |
| **Live feed**                  | Simulated WebSocket feed with snapshot + sequenced deltas, resync on gaps, heartbeat watchdog, exponential backoff reconnection, offline handling; connection state in the header with details and a manual retry.                                                                                                                                                                  |
| **Themes**                     | Light (default) and a separately designed dark theme, persisted, applied before first paint.                                                                                                                                                                                                                                                                                        |

## Scripts

| Command                                    |                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `dev:web`                  | Development with the ws feed server / with the in-browser worker feed                                                     |
| `npm run feed`                             | The WebSocket feed server alone (`FEED_PORT`, default 4001)                                                               |
| `npm run build` / `start` / `start:all`    | Production build / serve / serve with the feed server                                                                     |
| `npm run verify`                           | Typecheck + lint + all tests                                                                                              |
| `npm test` / `test:coverage` / `test:perf` | Tests / with coverage / engine benchmarks (`PERF_REPORT=1` writes `reports/engine-benchmarks.json`)                       |
| `npm run perf:measure`                     | Browser measurements against a running production build → `reports/runtime.json`                                          |
| `npm run perf:lighthouse`                  | Lighthouse (desktop + mobile) against a running production build → `reports/lighthouse.json`, `reports/lighthouse/*.html` |

## Configuration

Copy `.env.example` to `.env.local`. Nothing is secret; no API keys are needed.

| Variable               | Default                 | Meaning                                                                                                                                                                                 |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_FEED_URL` | empty                   | Set (e.g. `ws://localhost:4001`) to use the ws feed server; empty runs the same feed protocol in a Web Worker, so deployments without a socket server still stream. Read at build time. |
| `FEED_PORT`            | `4001`                  | Port of `server/feed-server.ts`.                                                                                                                                                        |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Base URL for metadata.                                                                                                                                                                  |

## Deployment

The app is a standard Next.js build and deploys to Vercel with no configuration:

1. Push the repository to GitHub.
2. On [vercel.com](https://vercel.com) → **Add New… → Project**, import the repository. Framework: Next.js (detected). Build command, output and install settings: leave the defaults.
3. Environment variables: none are required. Leave `NEXT_PUBLIC_FEED_URL` empty — Vercel cannot host the long-lived WebSocket server, so the same feed protocol runs in a Web Worker in each browser. Optionally set `NEXT_PUBLIC_SITE_URL` to the production URL (otherwise Vercel's production domain is used for metadata, `robots.txt` and the sitemap).
4. Deploy. Every push to the main branch redeploys.

On a host that can run a long-lived Node process, run `npm run feed` next to `npm start` and build with `NEXT_PUBLIC_FEED_URL` pointing at it to use the real WebSocket transport. The universe is generated on first request (~1–3 s) and cached per trading day; `src/instrumentation.ts` warms it at server start.

## Quality

- 256 tests (Vitest + Testing Library): filter engine (27, incl. every preset and 300 random nested expressions checked against an independent reference), indicators (pinned to Wilder's worked RSI example), data generation, chart data, feed client state machine, a real ws server ↔ client integration, the full live path into the stores, every API route, stores, and component tests of the main workspaces. Coverage ≈ 89% of lines (threshold 70%). Accessibility: axe-core reports 0 WCAG 2.1 A/AA violations on every route (desktop and phone, light and dark); Lighthouse accessibility, best practices and SEO are 100.
- TypeScript strict, ESLint (Next + React Compiler rules) clean, Prettier, Husky + lint-staged on commit.
- Measured performance: see [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md). Design and data flow: see [ARCHITECTURE.md](ARCHITECTURE.md). Build log: [progress/](progress/).

## Project layout

```
src/app/            routes (App Router): (market)/ home, screener, watchlist, [symbol], api/*
src/components/     Boot, MarketOverview, Screener, DataGrid, FilterPanel, Chart, StockDetail,
                    Watchlist, CommandPalette, Layout, ui
src/lib/            filterEngine, filters/*, mockDataGenerator, market/*, priceSimulator,
                    feed/*, technicalIndicators, chartData, performance, boot, server/*
src/hooks/          useStockScreener, useFilterEngine, useWebSocket, useStockData, useHistory, …
src/stores/         stockStore, filterStore, watchlistStore, uiStore, feedStore (Zustand)
src/workers/        in-browser market feed
server/             WebSocket feed server
tests/              unit, integration, server, api, stores, components, hooks, performance
scripts/            measure-runtime.mjs, run-lighthouse.mjs
```
