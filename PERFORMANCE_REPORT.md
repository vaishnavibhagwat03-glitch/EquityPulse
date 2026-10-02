# EquityPulse — Performance Report

Every number below was measured; none is estimated. Raw results are in `reports/` (`runtime.json`, `lighthouse.json`, `lighthouse/*.html`, `engine-benchmarks.json`) and can be regenerated with the commands at the end.

## Environment

|          |                                                                                           |
| -------- | ----------------------------------------------------------------------------------------- |
| Machine  | Intel Core i3-10110U @ 2.10 GHz (4 threads), 7.8 GB RAM, Windows 11 x64 — a modest laptop |
| Build    | `next build` + `next start` (production), live feed in a Web Worker                       |
| Browser  | Chrome 154, headless, 1440 × 900, DPR 1 (driven by playwright-core)                       |
| Runtime  | Node 24.18.0                                                                              |
| Date     | 2 October 2026                                                                            |
| Universe | 5,247 securities                                                                          |

Headless Chrome renders without a physical display; scroll figures describe frames Chrome produced and presented, read from its own tracing.

## Targets (desktop — the primary platform per the brief)

| Target                                    | Result                                                                                                                                                                                                                                                   | How measured                                                     |     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --- |
| LCP < 2.5 s                               | Home 560 ms (first visit, boot sequence playing), Screener 388 ms. Lighthouse desktop: Home 720 ms, Screener 778 ms, Stock page 2,280 ms                                                                                                                 | web-vitals in page; Lighthouse 13.5 desktop preset               | ✅  |
| TTI < 3.5 s                               | Home 1,063 ms, Screener 1,091 ms, Stock page 2,280 ms                                                                                                                                                                                                    | Lighthouse desktop                                               | ✅  |
| CLS < 0.1                                 | Home 0.0024, Screener 0.0041 (in page); 0.0026 / 0.0115 / 0.0093 (Lighthouse)                                                                                                                                                                            | web-vitals; Lighthouse                                           | ✅  |
| Filter < 200 ms (5,000 stocks, 5 filters) | Engine: 5 simultaneous conditions p95 **2.2 ms** cold, 0.25 ms while one changes. In the app: click on a preset → result count updated → painted **84–143 ms**                                                                                           | Vitest benchmark (Node); in-page timing click → DOM → next frame | ✅  |
| Sort < 150 ms                             | Engine: first sort of a column p95 **2.1 ms** (12.7 ms by name). In the app: header click → painted **122–131 ms**                                                                                                                                       | as above                                                         | ✅  |
| Scroll > 55 fps                           | Real wheel gesture, 7,200 px down and back at 2,400 px/s: **59 fps presented, 362 of 362 frames on the next vsync, 0 janky frames** (Chrome ScrollJankV4); **0 frames with blank rows**. Page main thread: 53.3 fps mean, frame p50 16.7 ms, p95 16.8 ms | Chrome tracing + in-page probes                                  | ✅  |
| Memory < 150 MB with 5,000 rows           | **23.7 MB** JS heap used (after 30 s of live streaming, then GC); 3,473 DOM nodes; 49 grid rows in the DOM out of 5,247                                                                                                                                  | Chrome DevTools Protocol `Performance.getMetrics`                | ✅  |
| WebSocket receipt → render < 50 ms        | p50 **7.9 ms**, p95 **16.2 ms**, max 20.5 ms (127 samples over 30 s at ~116 updates/s)                                                                                                                                                                   | timestamp at message receipt → price cell's layout effect        | ✅  |

### Boot sequence timing

|              | Target    | Measured (from navigation start)                                                 |                |
| ------------ | --------- | -------------------------------------------------------------------------------- | -------------- |
| First visit  | 1.8–2.8 s | hand-off begins **2.55 s**; the grid's staggered entrance has finished by 3.86 s | ✅             |
| Return visit | 0.6–0.9 s | hand-off begins **0.95 s**; settled by 2.25 s                                    | ⚠️ ~50 ms over |

The return sequence's own steps take ≤ 0.35 s once the page's JavaScript is running; most of the 0.95 s is the page starting up on this machine. LCP is not affected: the masthead under the overlay is server-rendered.

## Mobile (Lighthouse default mobile profile: simulated slow 4G, 4× CPU slowdown)

| Page              | Performance | LCP    | TTI    | TBT   | CLS       |
| ----------------- | ----------- | ------ | ------ | ----- | --------- |
| Home `/`          | 49          | 13.3 s | 13.3 s | 1.2 s | 0         |
| Screener          | 43          | 3.3 s  | 5.1 s  | 1.8 s | **0.568** |
| Stock `/RELIANCE` | 45          | 14.0 s | 14.0 s | 1.4 s | 0         |

**Not met.** The targets are met on desktop only. Known or likely causes, not yet fixed:

- **Screener CLS 0.568 (mobile):** the desktop / phone layout is chosen in JavaScript (media-query hooks assume desktop during server rendering). On a phone the 320 px filter panel is swapped for a drawer after hydration and the results section moves; Lighthouse attributes the shift to that section. Fix: choose the layout in CSS.
- **Home and stock LCP 13–14 s (mobile):** not yet diagnosed. Under simulated slow 4G and a 4× slower CPU the largest paint lands behind the main JavaScript and data requests; the universe payload (1.76 MB uncompressed) and 1.2–1.8 s of main-thread blocking are the likely contributors.

## Engine benchmarks (Node, same machine)

`npm run test:perf` — each case is warmed up once, then timed over repeated runs; budgets are asserted on the p95.

| Case                                             | Runs | Median   | p95      | Budget |
| ------------------------------------------------ | ---- | -------- | -------- | ------ |
| Filter · 5 conditions · cold (no cache)          | 30   | 0.79 ms  | 2.18 ms  | 200 ms |
| Filter · 5 conditions · one condition changed    | 60   | 0.16 ms  | 0.25 ms  | 200 ms |
| Filter + sort · 5 conditions                     | 30   | 0.11 ms  | 0.48 ms  | 200 ms |
| Filter · 20 nested conditions · cold             | 30   | 1.71 ms  | 2.59 ms  | 200 ms |
| Sort · first sort of a numeric column            | 30   | 1.69 ms  | 2.09 ms  | 150 ms |
| Sort · by name (string collation)                | 15   | 10.37 ms | 12.70 ms | 150 ms |
| Store · apply 500 live quotes                    | 50   | 0.49 ms  | 1.38 ms  | 16 ms  |
| Columns · fold 500 live rows into filter columns | 20   | 4.35 ms  | 9.83 ms  | —      |
| Universe · parse + decode 5,247 rows (1.76 MB)   | 10   | 105 ms   | 157 ms   | —      |
| Search · one keystroke over 5,247 securities     | 100  | 1.49 ms  | 2.94 ms  | 16 ms  |

In the browser the same decode measured 58.6 ms.

## What changed because of measurement

| Finding                                                                                          | Change                                                                                                     | Effect (same method before / after)                                |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The grid gave TanStack Table all 5,247 matching rows; its row model was rebuilt on every re-sort | Table manages columns only; rows render straight from the engine result, only in view                      | JS heap after 30 s streaming: 113.1 MB → 23.7 MB                   |
| Scroll traces: paint and layerisation dominated, not JavaScript                                  | One translated row window instead of a transform per row; cells reduced to fewer elements; overscan 12 → 8 | Main-thread paint in a 2 s scroll trace: ~715–776 ms → ~586–596 ms |
| The 2 s live re-sort produced the only long task during scrolling                                | Live re-screens pause while the grid scrolls                                                               | 0 janky scroll frames                                              |
| Tweens mixed rAF and `performance.now()` clocks                                                  | One clock, clamped progress                                                                                | Removed a visible bad value (breadth briefly read "−1,67,357")     |

## Lighthouse — other categories (desktop / mobile)

| Page     | Accessibility | Best practices | SEO     |
| -------- | ------------- | -------------- | ------- |
| Home     | 96 / 96       | 100 / 100      | 91 / 91 |
| Screener | 92 / 95       | 100 / 100      | 91 / 91 |
| Stock    | 92 / 92       | 100 / 100      | 92 / 92 |

Accessibility issues reported, not yet fixed: low contrast on some 10.5 px faint labels; accessible names that differ from visible text (top-bar search button, preset cards); the grid's row window wrapper inside the row group (`aria-required-children`); `aria-label` on the chart container without a role; a heading level skipped in the fundamentals tab; Lightweight Charts' internal layout table (`td-has-header`, third party). SEO: no `robots.txt`.

## Tests

`npm run test:coverage` on the final code: **252 tests in 20 files, all passing.** Coverage 89.8 % lines, 88.5 % statements, 84.1 % functions, 76.7 % branches (thresholds 70 / 70 / 70 / 60). What the tests cover is listed in [README.md](README.md#quality).

## Reproduce

```bash
npm run build && npm start              # terminal 1
npm run perf:measure                    # terminal 2 → reports/runtime.json
npm run perf:lighthouse                 # → reports/lighthouse.json (3 runs per page; this report used --runs 1)
PERF_REPORT=1 npm run test:perf         # → reports/engine-benchmarks.json
```

Results vary with the machine. Two `perf:measure` runs on this laptop with the final grid code agreed closely (home LCP 584 vs 560 ms, scroll main-thread fps 53.5 vs 53.3, tick → render p95 17.4 vs 16.2 ms).
