#!/usr/bin/env node
/**
 * Runtime measurements against a running production build.
 *
 *   npm run build && npm start          # in one terminal
 *   npm run perf:measure                # in another
 *
 * Options: --url <base> (default http://localhost:3000), --out <file>
 * (default reports/runtime.json). Chrome is found at CHROME_PATH or the usual
 * install locations; playwright-core drives it headless.
 *
 * Every number is read from the app's own collectors (window.__EQUITYPULSE_PERF__,
 * see src/lib/performance.ts) or from the Chrome DevTools Protocol. Nothing is
 * estimated. Headless Chrome renders without a display, so frame-rate figures
 * describe the main thread's ability to produce frames, not a physical screen.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright-core';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce(
      (pairs, arg, i, all) =>
        arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs,
      [],
    ),
);
const BASE = (args.url ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT = args.out ?? 'reports/runtime.json';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome/Chromium executable.');
  return found;
}

const round = (v, d = 1) =>
  v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d;
const perf = page => page.evaluate(() => window.__EQUITYPULSE_PERF__?.snapshot() ?? null);
const log = (...m) => console.log('[measure]', ...m);

/**
 * Chrome's ScrollJankV4 records, per presented scroll frame, whether it was
 * janky and how many vsyncs passed since the previous one.
 */
function scrollJank(tracePath) {
  const raw = JSON.parse(readFileSync(tracePath, 'utf8'));
  const events = (raw.traceEvents ?? raw).filter(
    e => e.name === 'ScrollJankV4' && e.ph === 'b' && e.args?.scroll_jank_v4,
  );
  if (!events.length) return { frames: 0, note: 'no ScrollJankV4 events in this Chrome build' };
  const data = events.map(e => e.args.scroll_jank_v4);
  const janky = data.filter(d => d.is_janky).length;
  const spanMs = (events.at(-1).ts - events[0].ts) / 1000;
  return {
    frames: events.length,
    jankyFrames: janky,
    jankyPercent: round((janky / events.length) * 100, 2),
    framesOnNextVsync: data.filter(d => (d.vsyncs_since_previous_frame ?? 1) <= 1).length,
    presentedFps: round((events.length - 1) / (spanMs / 1000)),
    vsyncMs: round((data[0].vsync_interval_us ?? 16666) / 1000, 2),
  };
}

async function context(browser, { returning = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  if (returning)
    await ctx.addInitScript(() =>
      localStorage.setItem('ep:intro', JSON.stringify({ seen: Date.now(), v: 1 })),
    );
  return ctx;
}

/** Waits for the app to expose its collectors, then for web-vitals to have reported. */
async function settle(page, ms = 1500) {
  await page.waitForFunction(() => Boolean(window.__EQUITYPULSE_PERF__), null, { timeout: 30_000 });
  await page.waitForTimeout(ms);
}

async function firstVisit(browser) {
  const ctx = await context(browser);
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    // Record when the boot sequence hands over and finishes.
    const marks = (window.__bootMarks = {});
    // Init scripts run before <html> exists: watch the whole document.
    new MutationObserver(() => {
      const state = document.documentElement?.dataset.intro;
      if (state && !(state in marks)) marks[state] = performance.now();
      if (state && !marks.mode) marks.mode = state;
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-intro'],
    });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset.intro === 'done', null, {
    timeout: 20_000,
  });
  // An interaction makes LCP final, as it is for a real visitor.
  await settle(page, 1000);
  await page.mouse.click(5, 300);
  await page.waitForTimeout(500);
  const snapshot = await perf(page);
  const marks = await page.evaluate(() => window.__bootMarks);
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return {
      ttfb: n.responseStart,
      domContentLoaded: n.domContentLoadedEventEnd,
      load: n.loadEventEnd,
      transferKB: n.transferSize / 1024,
    };
  });
  await ctx.close();
  return {
    introMode: marks.mode ?? null,
    introHandoffMs: round(marks.handoff),
    introDoneMs: round(marks.done),
    vitals: Object.fromEntries(
      Object.entries(snapshot.vitals).map(([k, v]) => [k, round(v, k === 'CLS' ? 4 : 0)]),
    ),
    navigation: {
      ttfbMs: round(nav.ttfb),
      domContentLoadedMs: round(nav.domContentLoaded),
      loadMs: round(nav.load),
      documentKB: round(nav.transferKB),
    },
    longTasks: snapshot.longTasks,
  };
}

async function returnVisit(browser) {
  const ctx = await context(browser, { returning: true });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const marks = (window.__bootMarks = {});
    // Init scripts run before <html> exists: watch the whole document.
    new MutationObserver(() => {
      const state = document.documentElement?.dataset.intro;
      if (state && !(state in marks)) marks[state] = performance.now();
      if (state && !marks.mode) marks.mode = state;
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-intro'],
    });
    // The return sequence is CSS: its overlay is gone when the fade animation ends.
    document.addEventListener('animationend', event => {
      if (event.animationName === 'ep-boot-return-out') marks.overlayGone = performance.now();
    });
  });
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset.intro === 'done', null, {
    timeout: 20_000,
  });
  const marks = await page.evaluate(() => window.__bootMarks);
  const firstPaint = await page.evaluate(
    () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
  );
  await ctx.close();
  return {
    introMode: marks.mode ?? null,
    firstPaintMs: round(firstPaint),
    overlayGoneMs: round(marks.overlayGone),
    sequenceMs: round(marks.overlayGone - firstPaint),
    settledMs: round(marks.done),
  };
}

async function screener(browser) {
  const ctx = await context(browser, { returning: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const t0 = Date.now();
  await page.goto(`${BASE}/screener`, { waitUntil: 'commit' });
  await page.waitForSelector('[role="grid"] [role="rowgroup"] > [role="row"]', { timeout: 60_000 });
  const gridReadyMs = Date.now() - t0;
  await settle(page, 2000);
  await page.mouse.click(700, 120);
  await page.waitForTimeout(300);
  const loaded = await perf(page);

  // Filters and sorts, timed inside the page: click → DOM updated → next
  // paint. (Timing from the test driver would add its own round trips.)
  const filters = [];
  for (const name of [
    'Value Stocks',
    'Growth Momentum',
    'Large Cap Quality',
    'Technical Breakout',
  ]) {
    const timing = await page.evaluate(async label => {
      const button = [...document.querySelectorAll('button')].find(
        b => b.textContent.trim() === label,
      );
      const count = document.querySelector('#screener-title + p');
      const before = count.textContent;
      const t0 = performance.now();
      button.click();
      await new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (count.textContent !== before) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(count, { subtree: true, childList: true, characterData: true });
      });
      const dom = performance.now() - t0;
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      return { dom, paint: performance.now() - t0, matched: count.textContent.trim() };
    }, name);
    const s = await perf(page);
    filters.push({
      preset: name,
      engineMs: round(s.filterMs.last, 2),
      clickToDomMs: round(timing.dom),
      clickToPaintMs: round(timing.paint),
      matched: timing.matched,
    });
  }
  await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Clear all')
      ?.click(),
  );
  await page.waitForTimeout(300);

  const sorts = [];
  for (const label of ['P/E', 'ROE', 'Change']) {
    const timing = await page.evaluate(async text => {
      const header = [...document.querySelectorAll('[role="columnheader"]')].find(h =>
        h.textContent.trim().startsWith(text),
      );
      const t0 = performance.now();
      header.querySelector('button').click();
      await new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (header.getAttribute('aria-sort') === 'descending') {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(header, { attributes: true, attributeFilter: ['aria-sort'] });
      });
      const dom = performance.now() - t0;
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      return { dom, paint: performance.now() - t0 };
    }, label);
    const s = await perf(page);
    sorts.push({
      column: label,
      engineMs: round(s.sortMs.last, 2),
      clickToDomMs: round(timing.dom),
      clickToPaintMs: round(timing.paint),
    });
  }
  // Back to the default (live) market-cap sort for the scroll and streaming runs.
  await page.evaluate(() => localStorage.removeItem('ep:screener'));
  await page.reload({ waitUntil: 'commit' });
  await page.waitForSelector('[role="grid"] [data-grid-body] [role="row"]', { timeout: 60_000 });
  await page.waitForTimeout(2000);

  // Scrolling: a real wheel gesture through the compositor (down 7,200 px and
  // back at 2,400 px/s, about 70 rows a second). Three views of it:
  //  - Chrome's own scroll-jank metric (ScrollJankV4): was every scroll frame
  //    presented on its vsync? This is what the user sees: scrolling is
  //    threaded, so the compositor moves content even when the page is busy.
  //  - Blank rows: did the virtual window ever fall behind the viewport?
  //  - Main-thread frame rate: how often the page itself produced a frame.
  await page.evaluate(() => {
    window.__EQUITYPULSE_PERF__.reset();
    window.__stopFps = window.__EQUITYPULSE_PERF__.startFps();
    const grid = document.querySelector('[role="grid"]');
    const body = grid.querySelector('[data-grid-body]');
    const viewport = grid.clientHeight - 34;
    const probe = (window.__coverage = { frames: 0, uncovered: 0, worstGapPx: 0, run: true });
    const loop = () => {
      if (!probe.run) return;
      const rendered = body.firstElementChild;
      const offset = Number(
        /translateY\((-?[\d.]+)px\)/.exec(rendered?.style.transform ?? '')?.[1] ?? 0,
      );
      const count = rendered?.childElementCount ?? 0;
      const top = grid.scrollTop;
      const gap = Math.max(offset - top, top + viewport - (offset + count * 34), 0);
      probe.frames++;
      if (gap > 1 && count) {
        probe.uncovered++;
        probe.worstGapPx = Math.max(probe.worstGapPx, gap);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const box = await page.locator('[role="grid"]').boundingBox();
  const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const tracePath = join(tmpdir(), `equitypulse-scroll-${process.pid}.json`);
  await browser.startTracing(page, {
    path: tracePath,
    categories: [
      'input',
      'benchmark',
      'cc',
      'disabled-by-default-cc.debug',
      'latencyInfo',
      'devtools.timeline',
    ],
  });
  await cdp.send('Input.synthesizeScrollGesture', {
    ...at,
    yDistance: -7200,
    speed: 2400,
    gestureSourceType: 'mouse',
  });
  await cdp.send('Input.synthesizeScrollGesture', {
    ...at,
    yDistance: 7200,
    speed: 2400,
    gestureSourceType: 'mouse',
  });
  await browser.stopTracing();
  const coverage = await page.evaluate(() => {
    window.__coverage.run = false;
    window.__stopFps();
    return window.__coverage;
  });
  const scroll = await perf(page);
  const jank = scrollJank(tracePath);
  rmSync(tracePath, { force: true });

  // Stream live prices for 30 s, then read latency and memory (after a GC).
  await page.evaluate(() => window.__EQUITYPULSE_PERF__.reset());
  await page.waitForTimeout(30_000);
  const streaming = await perf(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(500);
  const metrics = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]),
  );
  const feed = await page.evaluate(() => document.querySelector('footer')?.innerText ?? '');
  await ctx.close();

  return {
    gridReadyMs,
    vitals: Object.fromEntries(
      Object.entries(loaded.vitals).map(([k, v]) => [k, round(v, k === 'CLS' ? 4 : 0)]),
    ),
    universe: {
      rows: loaded.gauges.gridTotal,
      decodeMs: loaded.gauges.universeDecodeMs,
      rowsInDom: loaded.gauges.gridRows,
    },
    filters,
    sorts,
    scroll: {
      gesture: '7,200 px down and back at 2,400 px/s (real wheel input)',
      presented: jank,
      blankRows: {
        mainFramesChecked: coverage.frames,
        framesWithGap: coverage.uncovered,
        worstGapPx: round(coverage.worstGapPx),
      },
      mainThread: {
        fpsMean: round(scroll.fps.mean),
        frameMsP50: round(scroll.frameMs.p50, 2),
        frameMsP95: round(scroll.frameMs.p95, 2),
        longTasks: scroll.longTasks,
      },
    },
    streaming: {
      seconds: 30,
      feed: feed.replace(/\s+/g, ' ').trim(),
      tickToRenderMs: {
        p50: round(streaming.tickLatencyMs.p50, 2),
        p95: round(streaming.tickLatencyMs.p95, 2),
        max: round(streaming.tickLatencyMs.max, 2),
        samples: streaming.tickLatencyMs.count,
      },
      batchApplyMs: {
        p50: round(streaming.flushMs.p50, 3),
        p95: round(streaming.flushMs.p95, 3),
        samples: streaming.flushMs.count,
      },
      longTasks: streaming.longTasks,
    },
    memory: {
      jsHeapUsedMB: round(metrics.JSHeapUsedSize / 1048576),
      jsHeapTotalMB: round(metrics.JSHeapTotalSize / 1048576),
      domNodes: metrics.Nodes,
      layoutObjects: metrics.LayoutObjects ?? null,
    },
  };
}

async function main() {
  const health = await fetch(`${BASE}/api/health`)
    .then(r => r.json())
    .catch(() => null);
  if (!health?.success)
    throw new Error(`No EquityPulse server at ${BASE}. Run "npm run build && npm start" first.`);
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--enable-precise-memory-info'],
  });
  try {
    log('first visit (full boot sequence)…');
    const first = await firstVisit(browser);
    log('return visit…');
    const again = await returnVisit(browser);
    log('screener: load, filter, sort, scroll, stream 30 s…');
    const grid = await screener(browser);
    const report = {
      measuredAt: new Date().toISOString(),
      target: BASE,
      build: 'next build && next start (production)',
      universe: health.data,
      environment: {
        browser: `${browser.version()} (headless)`,
        cpu: cpus()[0]?.model,
        cores: cpus().length,
        memoryGB: round(totalmem() / 1073741824),
        platform: `${process.platform} ${process.arch}`,
        node: process.version,
        viewport: '1440×900, DPR 1',
      },
      home: { firstVisit: first, returnVisit: again },
      screener: grid,
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2));
    log(`written ${OUT}`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`[measure] ${error.message}`);
  process.exit(1);
});
