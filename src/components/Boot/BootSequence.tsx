'use client';

import { useEffect, useRef, useState } from 'react';
import {
  actualStage,
  advanceClock,
  beatProgress,
  BOOT_FLAG,
  currentBeat,
  displayedStage,
  markIntroSeen,
  skipClock,
  RETURN_SEQUENCE,
  SLOW_START_MS,
  stageLabel,
  startClock,
  TIMELINES,
  type TimedIntroMode,
  type BootStage,
  type Timeline,
} from '@/lib/boot';
import { direction, formatInteger, formatNumber, formatPercent } from '@/lib/format';
import { useFeedStore } from '@/stores/feedStore';
import { useStockStore } from '@/stores/stockStore';
import { Wordmark } from '@/components/Layout/Wordmark';
import { Headline } from '@/components/MarketOverview/Headline';
import type { BootInput } from './bootInput';
import { buildScene, drawIntro, sweepX, type IntroColors, type IntroScene } from './introCanvas';

/**
 * The first-load sequence: the system comes online, then becomes the home page.
 *
 * Rendered on the server, so the first paint is already the opening frame (no
 * spinner, no blank page); an inline head script decides before paint whether
 * it shows at all (see lib/boot.ts). One rAF loop drives everything: it
 * advances the pacing clock, draws the canvas and flips data attributes that
 * CSS turns into transitions — React does not re-render per frame.
 *
 * Hand-off: the wordmark flies to the navigation's wordmark and the headline
 * onto the masthead's own headline while the backdrop fades and the market
 * grid emerges around them, so the loading screen becomes the page.
 */

declare global {
  interface Window {
    [BOOT_FLAG]?: boolean;
  }
}

const ACTIVE = new Set(['full', 'return', 'reduced']);
/** Time after the hand-off starts for the grid's staggered entrance to finish. */
const EMERGE_TAIL_MS = 1300;
/** Dev-mode hydration (on-demand compilation) says nothing about real start-up time. */
const SLOW_START = process.env.NODE_ENV === 'development' ? Infinity : SLOW_START_MS;

/**
 * An unmount mid-sequence uncovers the page — but only if no remount follows
 * within a tick (React's development StrictMode mounts effects twice).
 */
let pendingCancel: ReturnType<typeof setTimeout> | undefined;

function readColors(): IntroColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string): string => cs.getPropertyValue(name).trim();
  return {
    ink: v('--text'),
    faint: v('--text-faint'),
    muted: v('--text-muted'),
    line: v('--border-strong'),
    positive: v('--positive'),
    negative: v('--negative'),
  };
}

function setFlag(el: HTMLElement, name: string, on: boolean): void {
  if (on) {
    if (!(name in el.dataset)) el.dataset[name] = '';
  } else if (name in el.dataset) {
    delete el.dataset[name];
  }
}

/** Animates `el` onto `target`'s box (FLIP), fading out as it lands. */
function flyTo(el: HTMLElement, target: Element | null, duration: number): void {
  // Without the Web Animations API the backdrop still fades; the copy just does not fly.
  if (typeof el.animate !== 'function') return;
  if (!target) {
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.6, fill: 'forwards' });
    return;
  }
  const from = el.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const scale = to.width / from.width;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const end = `translate(${dx}px, ${dy}px) scale(${scale})`;
  el.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: end, opacity: 1, offset: 0.72 },
      { transform: end, opacity: 0 },
    ],
    { duration, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
  );
}

export function BootSequence(props: BootInput) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [finished, setFinished] = useState(false);
  // Props are a server snapshot; the sequence keeps the first render's copy.
  const [input] = useState(props);

  useEffect(() => {
    const html = document.documentElement;
    clearTimeout(pendingCancel);
    const requested = html.dataset.intro;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!requested || !ACTIVE.has(requested) || !root || !canvas) return;
    window[BOOT_FLAG] = true;

    if (requested === 'full') markIntroSeen(window.localStorage);
    // A slow start has already shown the opening frame for a while: switch to
    // the short sequence, which CSS starts the moment the attribute changes.
    const downgraded = requested === 'full' && performance.now() > SLOW_START;
    if (requested === 'return' || downgraded) {
      if (downgraded) html.dataset.intro = 'return';
      // CSS has been running it since the first paint (or since the switch):
      // only tidy up once the overlay is gone and the page has settled.
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
      const started = downgraded || fcp === undefined ? performance.now() : fcp;
      const settledAt = started + RETURN_SEQUENCE.fadeStartMs + RETURN_SEQUENCE.emergeTailMs;
      const timer = setTimeout(
        () => {
          html.dataset.intro = 'done';
          setFinished(true);
        },
        Math.max(0, settledAt - performance.now()),
      );
      return () => clearTimeout(timer);
    }
    const mode = requested as TimedIntroMode;
    const tl: Timeline = TIMELINES[mode];
    root.dataset.mode = mode;

    const q = <T extends Element>(sel: string): T | null => root.querySelector<T>(sel);
    const wordmark = q<HTMLElement>('.boot-wordmark');
    const headline = q<HTMLElement>('.boot-headline-text');
    const glyph = q<HTMLElement>('.boot-glyph');
    const statusText = q<HTMLElement>('.boot-status-text');
    const readouts = Array.from(root.querySelectorAll<HTMLElement>('.boot-readout'));
    const metas = Array.from(root.querySelectorAll<HTMLElement>('.boot-meta'));
    const securities = formatInteger(input.securities);

    let colors = readColors();
    let scene: IntroScene | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let width = 0;
    let height = 0;

    /* -------------------------------------------------------------- layout */

    const placeFragments = (s: IntroScene, narrow: boolean): void => {
      const perRow = narrow ? 2 : 4;
      const slotW = s.grid.w / perRow;
      // Scattered constellation around the signal, clear of the wordmark.
      const scatter = [
        [-0.31, -0.13],
        [0.17, -0.17],
        [-0.22, 0.17],
        [0.21, 0.11],
        [-0.42, 0.03],
        [0.37, -0.03],
        [-0.07, 0.26],
        [0.08, -0.25],
        [0.4, 0.22],
        [-0.38, 0.24],
      ];
      const fragments = [...readouts, ...metas];
      fragments.forEach((el, i) => {
        const [fx, fy] = scatter[i % scatter.length]!;
        const x = Math.min(width - el.offsetWidth - 12, Math.max(12, s.origin.x + fx * width));
        const y = Math.min(height - 40, Math.max(s.titleY + 44, s.origin.y + fy * height));
        el.style.setProperty('--sx', `${Math.round(x)}px`);
        el.style.setProperty('--sy', `${Math.round(y)}px`);
      });
      readouts.forEach((el, k) => {
        el.style.setProperty('--ax', `${Math.round(s.header.x + (k % perRow) * slotW)}px`);
        el.style.setProperty('--ay', `${Math.round(s.header.y + Math.floor(k / perRow) * 18)}px`);
        el.dataset.slot = String((k % perRow) / perRow + 0.5 / perRow);
      });
      // Meta fragments line up centred under the grid, wrapping if needed.
      const gap = 18;
      const lines: HTMLElement[][] = [[]];
      let lineW = 0;
      for (const el of metas) {
        const w = el.offsetWidth;
        if (lineW && lineW + gap + w > s.footer.w) {
          lines.push([]);
          lineW = 0;
        }
        lines[lines.length - 1]!.push(el);
        lineW += (lineW ? gap : 0) + w;
      }
      lines.forEach((line, li) => {
        const total = line.reduce((sum, el) => sum + el.offsetWidth, 0) + gap * (line.length - 1);
        let x = s.footer.x + (s.footer.w - total) / 2;
        for (const el of line) {
          el.style.setProperty('--ax', `${Math.round(x)}px`);
          el.style.setProperty('--ay', `${Math.round(s.footer.y + li * 16)}px`);
          x += el.offsetWidth + gap;
        }
      });
    };

    const layout = (): void => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (mode !== 'full') return;
      const narrow = width < 640;
      scene = buildScene({
        width,
        height,
        securities: input.securities,
        sectors: input.sectors,
        trace: input.trace,
        readoutRows: narrow ? 2 : 1,
      });
      root.style.setProperty('--title-dy', `${Math.round(scene.titleY - height / 2)}px`);
      placeFragments(scene, narrow);
    };
    layout();

    /* --------------------------------------------------------------- clock */

    let clock = startClock(tl, performance.now());
    let last = performance.now();
    let frame = 0;
    let shownStage: BootStage | null = null;
    let lastScramble = -Infinity;
    let handedOff = false;
    let tail: ReturnType<typeof setTimeout> | undefined;
    const resolved = new Set<HTMLElement>();
    const fragStart = tl.beats.fragments?.[0] ?? 0;
    const fragSpacing = 85;

    const readiness = () => {
      const feed = useFeedStore.getState();
      return {
        feedStarted: feed.status !== 'idle',
        universeLoaded: useStockStore.getState().stocks.length > 0,
        synced: feed.synced,
      };
    };

    const writeStatus = (stage: BootStage): void => {
      if (stage === shownStage) return;
      shownStage = stage;
      const label = stageLabel(stage, securities);
      if (glyph) glyph.textContent = label.glyph;
      if (statusText) statusText.textContent = label.text;
      root.dataset.stage = stage;
    };

    const writeReadout = (el: HTMLElement, k: number, exact: boolean, closeness: number): void => {
      const r = input.readouts[k];
      if (!r) return;
      const value = el.querySelector<HTMLElement>('.boot-frag-value');
      const change = el.querySelector<HTMLElement>('.boot-frag-change');
      if (exact) {
        if (value) value.textContent = formatNumber(r.value, 2);
        if (change) change.textContent = formatPercent(r.changePercent, { signed: true });
        el.dataset.resolved = '';
        return;
      }
      const spread = 1 - closeness;
      if (value)
        value.textContent = formatNumber(r.value * (1 + (Math.random() - 0.5) * 0.03 * spread), 2);
      if (change)
        change.textContent = formatPercent(r.changePercent + (Math.random() - 0.5) * 1.6 * spread, {
          signed: true,
        });
    };

    const handoff = (): void => {
      handedOff = true;
      const [a, b] = tl.beats.handoff!;
      const duration = Math.max(160, (b - a) / (readiness().universeLoaded ? tl.readyRate : 1));
      html.style.setProperty('--handoff-land', `${Math.round(duration * 0.7)}ms`);
      html.style.setProperty('--handoff-ms', `${Math.round(duration)}ms`);
      const headlineShown = 'reveal' in root.dataset;
      if (headlineShown) html.dataset.introFlip = 'headline';
      setFlag(root, 'handoff', true);
      html.dataset.intro = 'handoff';
      if (mode !== 'reduced') {
        if (wordmark) flyTo(wordmark, document.querySelector('[data-wordmark-target]'), duration);
        if (headline && headlineShown)
          flyTo(headline, document.querySelector('[data-hero-headline]'), duration);
      }
      tail = setTimeout(() => {
        html.dataset.intro = 'done';
        delete html.dataset.introFlip;
      }, EMERGE_TAIL_MS);
    };

    const render = (): void => {
      const t = clock.t;
      const beat = currentBeat(tl, t);
      root.dataset.beat = beat;
      const at = (b: keyof Timeline['beats']): boolean =>
        tl.beats[b] ? t >= tl.beats[b]![0] : false;
      setFlag(root, 'rise', mode === 'full' && at('signal') && !at('compress'));
      setFlag(root, 'aligned', at('grid'));
      setFlag(root, 'compress', at('compress'));
      setFlag(root, 'reveal', at('reveal'));

      writeStatus(displayedStage(tl, t, actualStage(readiness())));

      if (mode === 'full' && scene && ctx) {
        const f = {
          signal: beatProgress(tl, 'signal', t),
          points: beatProgress(tl, 'points', t),
          grid: beatProgress(tl, 'grid', t),
          sweep: beatProgress(tl, 'sweep', t),
          compress: beatProgress(tl, 'compress', t),
        };
        drawIntro(ctx, scene, f, colors);

        // Fragments: arrive one by one, flicker as values come in, and lock
        // to the exact snapshot value as the sweep passes over them.
        const sx = sweepX(scene, f.sweep);
        const closeness = Math.min(
          1,
          Math.max(0, (t - fragStart) / ((tl.beats.sweep?.[1] ?? 1) - fragStart)),
        );
        const scramble = t - lastScramble > 70;
        if (scramble) lastScramble = t;
        [...readouts, ...metas].forEach((el, i) =>
          setFlag(el, 'on', t >= fragStart + i * fragSpacing),
        );
        readouts.forEach((el, k) => {
          if (resolved.has(el) || t < fragStart + k * fragSpacing) return;
          const slot = Number(el.dataset.slot ?? 0.5);
          if (f.sweep >= 1 || sx >= scene!.grid.x + slot * scene!.grid.w) {
            resolved.add(el);
            writeReadout(el, k, true, 1);
          } else if (scramble) {
            writeReadout(el, k, false, closeness);
          }
        });
      }

      if (!handedOff && at('handoff')) handoff();
    };

    const skip = (event: Event): void => {
      if (event instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key))
        return;
      clock = skipClock(tl, clock);
    };
    const onResize = (): void => {
      colors = readColors();
      layout();
    };
    const teardown = (): void => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('wheel', skip);
      window.removeEventListener('touchstart', skip);
      window.removeEventListener('resize', onResize);
    };

    const tick = (now: number): void => {
      const r = readiness();
      clock = advanceClock(tl, clock, now - last, r.universeLoaded && r.synced);
      last = now;
      render();
      if (clock.done) {
        // Never leave the page covered, whatever happened above.
        if (!handedOff) handoff();
        teardown();
        setFinished(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    render();
    frame = requestAnimationFrame(tick);
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    window.addEventListener('wheel', skip, { passive: true });
    window.addEventListener('touchstart', skip, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      teardown();
      if (clock.done) return;
      // Unmounted mid-sequence (e.g. navigated away): uncover everything —
      // unless this is StrictMode's remount, which clears the timer first.
      if (tail) clearTimeout(tail);
      pendingCancel = setTimeout(() => {
        html.dataset.intro = 'done';
        delete html.dataset.introFlip;
      }, 0);
    };
  }, [input]);

  if (finished) return null;

  return (
    <div ref={rootRef} className="boot-root" aria-hidden="true" data-beat="frame">
      <div className="boot-bg" />
      <canvas ref={canvasRef} className="boot-canvas" />

      <div className="boot-frags num">
        {input.readouts.map(r => (
          <span
            key={r.label}
            className="boot-frag boot-readout"
            data-dir={direction(r.changePercent)}
          >
            <span className="text-ink-2">{r.label}</span>
            <span className="boot-frag-value text-ink">{formatNumber(r.value, 2)}</span>
            <span className="boot-frag-change">
              {formatPercent(r.changePercent, { signed: true })}
            </span>
          </span>
        ))}
        {input.meta.map(m => (
          <span key={m} className="boot-frag boot-meta">
            {m}
          </span>
        ))}
      </div>

      <div className="boot-title">
        <div className="boot-wordmark">
          <Wordmark size="xl" />
        </div>
        <p className="boot-sub boot-sub-1">Market intelligence system</p>
        <p className="boot-sub boot-sub-2">Initializing market data</p>
      </div>

      <div className="boot-headline">
        <Headline as="p" className="boot-headline-text" />
      </div>

      <p className="boot-status num">
        <span className="boot-glyph">○</span>
        <span className="boot-status-text">Connecting to market engine</span>
      </p>
    </div>
  );
}
