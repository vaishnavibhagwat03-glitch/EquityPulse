# EquityPulse — Architecture

## 1. Overview

```
            ┌──────────────── server (Next.js, Node) ────────────────┐
            │ mockDataGenerator ──► market model (5,247 stocks,       │
            │   per trading day, cached on globalThis)                │
            │        │                                                │
            │        ├─► /api/stocks?format=compact (columnar, ETag)  │
            │        ├─► /api/stocks/:s, /history, /fundamentals      │
            │        ├─► /api/market, /sectors, /indices, /screen     │
            │        └─► server-rendered pages: /, /[symbol]          │
            └─────────────────────────────────────────────────────────┘
                     │ compact universe (once/day)          │ ws://…:4001 (optional)
                     ▼                                      ▼
┌──────────────────────────── browser ─────────────────────────────────────────┐
│ TanStack Query (persisted to IndexedDB) ─► decode ─► stockStore              │
│                                                     ├─ stocks, bySymbol     │
│                                                     ├─ ColumnStore (typed   │
│                                                     │  arrays for filtering)│
│ Feed: WebSocketTransport or WorkerTransport ─► FeedClient ─► TickBatcher ─► │
│       (protocol v1: hello/snapshot/ticks/market)   (rAF)   stockStore.quotes│
│                                                     feedStore (status, mkt) │
│ filterStore (panel, sort, search) ─► panelToExpression ─► FilterEngine ─►   │
│   sorted row positions ─► DataGrid (TanStack Table columns + Virtual rows)  │
└──────────────────────────────────────────────────────────────────────────────┘
```

The same TypeScript runs in three places: the generator and filter engine on the server (API, `/api/screen`), the price engine in the ws server _or_ a Web Worker, and everything else in the browser.

## 2. Component boundaries

- **Routes (Server Components)** render shells, metadata and server data: `(market)/page.tsx` renders the home page from the day's snapshot (static, revalidated every 5 min); `[symbol]/page.tsx` renders the stock record, fundamentals and peers for SEO and a complete first paint. `screener` and `watchlist` are thin server routes around client workspaces.
- **Client workspaces** compose features and own no business logic: `ScreenerWorkspace`, `StockDetail`, `WatchlistWorkspace`, `MarketHome`.
- **Feature components** (`DataGrid`, `FilterPanel`, `Chart`, `CommandPalette`, `MarketOverview`, `Boot`) read stores through selectors and call pure functions in `src/lib`.
- **Pure logic** lives in `src/lib` and is framework-free: filter engine, panel compiler, indicators, chart data, generator, price engine, feed client/protocol, boot pacing, formatting. Everything testable lives here.
- **Accessibility**: semantic landmarks and headings, a full ARIA grid, labelled controls whose accessible names contain their visible text, WAI-ARIA tabs, dialogs with focus traps, visible focus, `prefers-reduced-motion`, and text colours that clear WCAG AA (4.5:1) on every surface in both themes. Checked with axe-core on every route, desktop and phone, light and dark.
- **Error boundaries** isolate regions: results grid, chart ("Chart temporarily unavailable." + RETRY), filter panel, command palette. Fallbacks never show stack traces; the chart can be failed on purpose from the palette (fault injection) to demonstrate it.
- **Code splitting**: the chart (Lightweight Charts), command palette, help dialog and performance monitor are dynamic imports; web-vitals loads after hydration.

## 3. State architecture

| Store            | Holds                                                                                         | Persisted                                           |
| ---------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `stockStore`     | universe, `bySymbol`, filter `ColumnStore`, live `quotes` map, `quoteVersion`, dirty set      | no (universe cached by TanStack Query in IndexedDB) |
| `feedStore`      | connection status, attempt, next retry, transport, RTT, ticks/s, live market aggregates       | no                                                  |
| `filterStore`    | panel values, group/root modes, custom expression, sort, search, saved screens, active preset | `localStorage` (`ep:screener`; search is per visit) |
| `watchlistStore` | watched symbols + version                                                                     | `localStorage` (`ep:watchlist`)                     |
| `uiStore`        | theme, panels, column layout, palette/help/perf overlays, recent securities                   | `localStorage` (`ep:ui`, theme also `ep:theme`)     |

Server state (universe, history, fundamentals) is TanStack Query; client state is Zustand. Persisted stores rehydrate after mount so server and first client render agree. Components subscribe to the smallest slice they need (`useQuote(symbol)` re-renders one cell when that symbol ticks).

## 4. Data flow

1. **Universe.** The generator builds the day's universe deterministically from the IST date (seeded factor model, sector profiles, index membership, derived ratios and indicators). The client loads it once as a columnar payload (1.85 MB of JSON, served gzipped as ~0.69 MB; built and compressed once per day; ETag'd), decodes it (~60 ms), and keeps it in IndexedDB so a return visit renders from disk while revalidating. Every page is server-rendered complete, so the download starts only after the first paint (and, except on the screener and watchlist, after the browser is idle): the largest contentful paint never waits for it.
2. **Screening.** Panel state → `panelToExpression` (an AND/OR/NOT tree) → `FilterEngine.screen` → sorted `Uint32Array` of row positions → grid. Inputs are deferred with `useDeferredValue`, so dragging a slider stays responsive while results follow.
3. **Live prices.** Feed deltas → `TickBatcher` (one store update per animation frame, latest value per symbol) → `stockStore.applyTicks` gives a new quote object only to symbols that ticked → only those cells re-render and flash. When a screen or sort depends on live fields, live values are folded into the columns and the screen re-runs every 2 s — but never while the user is scrolling the results.
4. **Detail.** History is fetched per symbol and interval, reconciled with the live quote, and each new tick updates the last candle (or opens a new intraday bucket).

## 5. WebSocket architecture

- **Protocol v1** (`src/lib/feed/protocol.ts`): server → `hello`, `snapshot` (all instruments), `ticks` (sequence-numbered deltas `[position, price, volume]`, ~20 bytes each), `market` (aggregates ~1/s), `heartbeat`, `pong`, `error`; client → `subscribe`, `resync`, `ping`, `rate`. Frames are validated; malformed ones are dropped.
- **Two transports, one client.** With `NEXT_PUBLIC_FEED_URL` set, `WebSocketTransport` talks to `server/feedServer.ts` (`ws`, per-message deflate, backpressure: a client over 1 MB of buffered data skips frames and recovers by resync). Without it, `WorkerTransport` runs the identical engine and protocol in a Web Worker, so static/serverless deployments still stream.
- **`FeedClient` state machine**: `idle → connecting → live`, and on loss `reconnecting` with exponential backoff (800 ms doubling to 15 s, equal jitter, 8 attempts) then `offline`; browser `offline`/`online` events are honoured; a heartbeat watchdog (12 s) treats silence as a dead link; a sequence gap triggers `resync`. Prices are never cleared on disconnect — the UI keeps the last values and shows the state.
- **Price engine** (`src/lib/priceSimulator.ts`): Ornstein–Uhlenbeck deviation around the snapshot with shared market and sector factors (stocks move together), NSE circuit bands and tick sizes, liquidity-weighted sampling, volume accrual.

## 6. Filter engine

`src/lib/filterEngine.ts`, framework-free and deterministic; the client, `/api/screen`, the tests and the benchmarks share it.

- **Columnar data.** `buildColumnStore` turns 5,247 objects into one `Float64Array` per numeric field (null → NaN, which fails every comparison — so a loss-maker never matches "P/E < 15"), dictionary-coded `Uint16Array`s for categories, bitmasks for index membership.
- **Bitsets.** Each condition is one tight loop producing a `Bitset`; groups combine with word-wise AND/OR/NOT (~164 words for 5,247 rows). AND short-circuits once empty.
- **Memoisation.** Condition results are cached (LRU, 512) by field, operator, value and the data versions they depend on — live fields include the live version, the watchlist condition the watchlist version — so moving one slider recomputes one condition.
- **Sorting** is by cached permutation: the first sort on a column orders all rows once; filtered views walk that permutation. Nulls sort last; ties keep market-cap order.
- **Validation.** Unknown fields, operator/field mismatches and malformed values are reported, not thrown, during a screen; the API additionally caps depth (6) and size (120 nodes).

## 7. Virtualisation (DataGrid)

- **TanStack Table owns the column model only** — headers, sizing, visibility, pinning — and is given no rows. Building its row model for 5,247 matches (objects and closures per row and cell) cost ~100 ms and ~90 MB; rows are instead rendered straight from the engine's result, only for the window in view.
- **TanStack Virtual** renders ~50 rows (viewport + 8 overscan each side) regardless of how many match. The rendered window is one translated container with rows in normal flow (one transform instead of one per row, which kept Chrome re-layerising every row while scrolling). That container is the grid's body row group, so rows are its direct children (grid → rowgroup → row → gridcell); the live row count sits outside the grid.
- Scrolling is threaded (compositor): the overscan is the budget for main-thread lag before a blank row could appear.
- Column widths are CSS variables on the grid root, so resizing restyles cells without re-rendering rows. Rows are memoised; cells subscribe to their own quote.

## 8. Caching

| Layer          | What                                                                                                                                                                   | Lifetime                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Server memory  | generated universe, compact JSON and its gzipped response, overview, fundamentals (bounded)                                                                            | one IST trading day per generator version |
| HTTP           | universe: gzip (pre-compressed), ETag + `max-age=60, s-maxage=600, stale-while-revalidate`; history daily/weekly cached, intraday `no-store`; pages gzipped by Next.js | per response                              |
| Next.js        | `/` static, revalidated every 5 min                                                                                                                                    | ISR                                       |
| TanStack Query | universe (persisted to IndexedDB), history (30 min daily / 1 min intraday), fundamentals                                                                               | per query                                 |
| Filter engine  | condition bitsets (LRU 512), sort permutations (24)                                                                                                                    | per data version                          |
| Search index   | built once per universe version for the palette                                                                                                                        | per version                               |

## 9. Performance decisions

Each optimisation exists because it was measured to matter (numbers in [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md)):

- **Columns + bitsets + caches** keep a 5-condition screen under ~3 ms on 5,247 rows, so filtering can run synchronously on every change.
- **Selective subscriptions + per-symbol quote objects + rAF batching**: a tick re-renders only the cells of the symbol that moved; 500 quotes apply in ~1 ms.
- **No table row model, one translated window, lean cells, overscan 8**: found by tracing scroll — paint and layerisation dominated; DOM churn was already minimal.
- **Live re-sort pauses during scroll**: a re-sort reorders every visible row; doing it mid-scroll caused the only long task during scrolling (and moved rows under the cursor).
- **Clock discipline**: tweens and FPS sampling use a single clock and clamp progress (a frame timestamp can precede the start of a tween).
- **Boot sequence never delays the app**: it is server-rendered (first paint is the opening frame, LCP is the masthead headline underneath), holds only for real readiness with a hard cap, speeds up when data is ready, and is skipped for deep links. The return-visit version (and a first visit whose JavaScript started slowly) is pure CSS from the first paint, so its 0.66 s does not depend on how fast the page hydrates.
- **Layout is decided in CSS, not script**: the screener's desktop / phone layouts are chosen by breakpoints, so the server-rendered HTML is already right on a phone and nothing moves when the page hydrates (this removed a 0.57 layout shift on phones). Script only decides what mounts inside the containers.
- **Universe compressed and deferred**: route handlers are not compressed by Next.js, so the universe was going out as 1.85 MB; it is now gzipped once per day (0.69 MB) and requested after the first paint.
- **Code splitting** of the chart and overlays, `optimizePackageImports`, and server-rendered first paints keep initial JavaScript off the critical path.

Instrumentation (`src/lib/performance.ts`) records filter/sort/flush timings, tick receipt-to-render latency, FPS, Web Vitals and long tasks; the in-app monitor (`PERF` in the status bar) and the measurement scripts read the same collectors.
