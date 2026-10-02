# Build progress

Built in the order the brief prescribes (phases 1 → 8), core screener first, landing experience after.

## Phase log

| Phase | Scope                                                                                                                                                                       | Status                                                                                                                                          |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Foundation: Next.js 16 App Router, strict TypeScript, Tailwind 4 design tokens (light + designed dark), types, deterministic generator for 5,247 securities, layout shell   | Done                                                                                                                                            |
| 2     | Virtualised grid (TanStack Table + Virtual), sorting, column pinning / resizing / visibility, fixed header, keyboard navigation                                             | Done                                                                                                                                            |
| 3     | Filter engine (columns, bitsets, caches), 53 filters, nested AND/OR/NOT builder, 6 presets, saved screens, chips, live count                                                | Done                                                                                                                                            |
| 4     | Stock detail: server-rendered page, Lightweight Charts candlesticks, 6 timeframes, SMA/EMA/Bollinger/RSI/volume profile, zoom/pan/crosshair/reset, fundamentals tabs, peers | Done                                                                                                                                            |
| 5     | Feed protocol, ws server + Web Worker transports, client state machine (backoff, watchdog, resync, offline), rAF batching, cell flashes                                     | Done                                                                                                                                            |
| 6     | Watchlist, command palette (Ctrl/⌘K, /), shortcuts and help, persistence                                                                                                    | Done                                                                                                                                            |
| 7     | Boot sequence (full / return / reduced), Market Grid home, Market → Screener transition                                                                                     | Done                                                                                                                                            |
| 8     | Tests (252, ≈90 % lines), lint/type clean, measured performance, Lighthouse, documentation                                                                                  | Done — desktop targets met; mobile performance, a few accessibility findings and return-visit intro timing are open (see PERFORMANCE_REPORT.md) |

## Notable findings while hardening (phase 8)

Tests and measurements surfaced real defects; each was fixed and is covered by a test:

- The grid gave TanStack Table all 5,247 rows; building its row model cost ~100 ms per re-sort and ~90 MB of heap. It now manages columns only (heap 113 MB → 24 MB).
- Scroll tracing showed paint and layerisation, not React, dominated: rows were moved to one translated window, cells slimmed, overscan tuned, and live re-sorts paused while scrolling. Chrome now presents every scroll frame on its vsync.
- `AnimatedNumber` and the FPS sampler mixed `performance.now()` with rAF timestamps (a value tween could extrapolate to nonsense); now one clock, clamped.
- The reconnect countdown read a clock captured at mount (could show "604s"); now read at render.
- Escape in numeric filter inputs committed the draft instead of reverting.
- The feed client treated a missing `navigator.onLine` (Node ≥ 21) as offline.
- A missing Web Animations API could take down the grid via the price flash.
- Phone widths overflowed in the top bar and the stock-page tabs.
- 15 lint errors (effects setting state for client-only values) replaced with `useSyncExternalStore` / derived state.

## Final round: Lighthouse findings (2 October 2026)

The first Lighthouse run met every target on desktop but not on its throttled mobile profile, and flagged accessibility issues. All were fixed, then re-measured:

- **Universe sent uncompressed.** Next.js does not compress route handler responses: the universe went out as 1.85 MB. It is now gzipped once per day (0.69 MB).
- **Lighthouse's mobile LCP estimate (13–14 s)** counted the universe download, which started before the first paint. Real throttled measurements showed LCP 1.5–2.0 s; the download now starts after the first paint.
- **Screener layout shift 0.57 on phones.** The desktop/phone layout was chosen in script, so phones briefly got the desktop layout. Now chosen by CSS breakpoints.
- **Return-visit intro 0.95 s (target 0.6–0.9 s).** It waited for JavaScript to start; it is now pure CSS from the first paint.
- **Accessibility:** faint text below 4.5:1, accessible names not matching visible labels, the grid's live region and row wrapper inside the grid, an unlabelled-role chart surface, a skipped heading level, the chart library's layout table. Now 0 axe-core violations on every route, desktop and phone, light and dark.
- **SEO:** added `robots.txt` and a sitemap.

## Not built, by choice

- Parallel-route modal for stock detail ("where useful" in the brief): the screener's context panel already shows a stock without leaving the grid; the full page is one keystroke away.
