#!/usr/bin/env node
/**
 * Lighthouse audits against a running production build.
 *
 *   npm run build && npm start          # in one terminal
 *   npm run perf:lighthouse             # in another
 *
 * Options: --url <base> (default http://localhost:3000), --runs <n> (default 3;
 * the median run per page and form factor is reported).
 *
 * Audits /, /screener and a stock page, each with Lighthouse's desktop preset
 * and its default mobile configuration (simulated slow 4G and 4× CPU
 * slowdown). Every run starts from a fresh profile, so / is measured as a
 * first visit: the boot sequence plays. Writes reports/lighthouse.json and the
 * median run's HTML report per page to reports/lighthouse/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

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
const RUNS = Math.max(1, Number(args.runs ?? 3));
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'screener', path: '/screener' },
  { name: 'stock', path: '/RELIANCE' },
];
const FORMS = [
  { name: 'desktop', config: desktopConfig },
  { name: 'mobile', config: undefined },
];

const round = (v, d = 0) =>
  v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d;
const metric = (lhr, id, d = 0) => round(lhr.audits[id]?.numericValue, d);

function summarise(lhr) {
  const score = id => round((lhr.categories[id]?.score ?? 0) * 100);
  return {
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      bestPractices: score('best-practices'),
      seo: score('seo'),
    },
    metrics: {
      fcpMs: metric(lhr, 'first-contentful-paint'),
      lcpMs: metric(lhr, 'largest-contentful-paint'),
      ttiMs: metric(lhr, 'interactive'),
      tbtMs: metric(lhr, 'total-blocking-time'),
      cls: metric(lhr, 'cumulative-layout-shift', 4),
      speedIndexMs: metric(lhr, 'speed-index'),
    },
    failedAudits: Object.values(lhr.audits)
      .filter(
        a =>
          a.score !== null &&
          a.score < 0.9 &&
          a.scoreDisplayMode !== 'informative' &&
          a.scoreDisplayMode !== 'manual' &&
          a.scoreDisplayMode !== 'notApplicable',
      )
      .map(a => ({ id: a.id, title: a.title, score: a.score, value: a.displayValue ?? null }))
      .slice(0, 12),
  };
}

async function main() {
  const health = await fetch(`${BASE}/api/health`)
    .then(r => r.json())
    .catch(() => null);
  if (!health?.success)
    throw new Error(`No EquityPulse server at ${BASE}. Run "npm run build && npm start" first.`);
  mkdirSync('reports/lighthouse', { recursive: true });
  const results = [];
  for (const page of PAGES) {
    for (const form of FORMS) {
      const runs = [];
      for (let i = 0; i < RUNS; i++) {
        // A fresh profile per run: no cache, no stored intro flag.
        const chrome = await chromeLauncher.launch({
          chromeFlags: ['--headless=new', '--no-first-run'],
          chromePath: process.env.CHROME_PATH,
        });
        try {
          const result = await lighthouse(
            `${BASE}${page.path}`,
            { port: chrome.port, output: 'html', logLevel: 'error' },
            form.config,
          );
          runs.push({ lhr: result.lhr, html: result.report });
        } finally {
          await chrome.kill();
        }
        console.log(
          `[lighthouse] ${page.name} ${form.name} run ${i + 1}/${RUNS}: performance ${round(runs.at(-1).lhr.categories.performance.score * 100)}`,
        );
      }
      // Median by performance score, then by LCP.
      runs.sort(
        (a, b) =>
          a.lhr.categories.performance.score - b.lhr.categories.performance.score ||
          metric(a.lhr, 'largest-contentful-paint') - metric(b.lhr, 'largest-contentful-paint'),
      );
      const median = runs[Math.floor(runs.length / 2)];
      writeFileSync(`reports/lighthouse/${page.name}-${form.name}.html`, median.html);
      results.push({
        page: page.path,
        formFactor: form.name,
        runs: RUNS,
        performanceScores: runs.map(r => round(r.lhr.categories.performance.score * 100)),
        median: summarise(median.lhr),
        lighthouse: median.lhr.lighthouseVersion,
        throttling: median.lhr.configSettings.throttlingMethod,
      });
    }
  }
  const report = {
    measuredAt: new Date().toISOString(),
    target: BASE,
    build: 'next build && next start (production)',
    environment: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
    },
    results,
  };
  writeFileSync('reports/lighthouse.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      results.map(r => ({
        page: r.page,
        form: r.formFactor,
        ...r.median.scores,
        ...r.median.metrics,
      })),
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(`[lighthouse] ${error.message}`);
  process.exit(1);
});
