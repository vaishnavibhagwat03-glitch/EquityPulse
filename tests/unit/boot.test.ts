import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  actualStage,
  advanceClock,
  beatProgress,
  currentBeat,
  displayedStage,
  easeInOutCubic,
  easeOutCubic,
  INTRO_BOOT_SCRIPT,
  INTRO_STORAGE_KEY,
  markIntroSeen,
  MAX_STEP_MS,
  resolveIntroMode,
  RETURN_SEQUENCE,
  skipClock,
  stageLabel,
  startClock,
  TIMELINES,
  type Clock,
  type Timeline,
} from '@/lib/boot';
import { bootInputFromOverview } from '@/components/Boot/bootInput';
import { buildOverview } from '@/lib/mockDataGenerator';
import { market } from '../fixtures/market';

/** Runs the clock at 60 fps until done; returns the real time it took. */
function run(tl: Timeline, ready: (realMs: number) => boolean, elapsedBefore = 0): number {
  let clock: Clock = startClock(tl, elapsedBefore);
  let guard = 0;
  while (!clock.done && guard++ < 10_000)
    clock = advanceClock(tl, clock, 1000 / 60, ready(clock.real));
  return clock.real;
}

describe('which sequence plays', () => {
  it('plays the full sequence once, then the short one; never on deep links', () => {
    expect(resolveIntroMode({ pathname: '/', seen: false, reducedMotion: false })).toBe('full');
    expect(resolveIntroMode({ pathname: '/', seen: true, reducedMotion: false })).toBe('return');
    expect(resolveIntroMode({ pathname: '/', seen: false, reducedMotion: true })).toBe('reduced');
    expect(resolveIntroMode({ pathname: '/', seen: true, reducedMotion: true })).toBe('none');
    expect(resolveIntroMode({ pathname: '/screener', seen: false, reducedMotion: false })).toBe(
      'none',
    );
  });

  it('the pre-paint script decides exactly as resolveIntroMode does', () => {
    for (const pathname of ['/', '/RELIANCE']) {
      for (const seen of [false, true]) {
        for (const reducedMotion of [false, true]) {
          const root = { dataset: {} as Record<string, string> };
          const timers: (() => void)[] = [];
          new Function(
            'document',
            'localStorage',
            'window',
            'location',
            'setTimeout',
            INTRO_BOOT_SCRIPT,
          )(
            { documentElement: root },
            { getItem: (k: string) => (k === INTRO_STORAGE_KEY && seen ? '{"seen":1}' : null) },
            { matchMedia: () => ({ matches: reducedMotion }) },
            { pathname },
            (fn: () => void) => timers.push(fn),
          );
          expect(root.dataset.intro, `${pathname} seen=${seen} reduced=${reducedMotion}`).toBe(
            resolveIntroMode({ pathname, seen, reducedMotion }),
          );
          // The failsafe uncovers the page if the app never took over.
          if (root.dataset.intro !== 'none') {
            expect(timers).toHaveLength(1);
            timers[0]!();
            expect(root.dataset.intro).toBe('none');
          }
        }
      }
    }
  });

  it('remembers that the full sequence was seen', () => {
    const store = new Map<string, string>();
    markIntroSeen({ setItem: (k, v) => store.set(k, v) }, 123);
    expect(JSON.parse(store.get(INTRO_STORAGE_KEY)!)).toEqual({ seen: 123, v: 1 });
    expect(() =>
      markIntroSeen({
        setItem: () => {
          throw new Error('quota');
        },
      }),
    ).not.toThrow();
  });
});

describe('pacing', () => {
  it('fits the specified durations when data is already there', () => {
    const full = run(TIMELINES.full, () => true);
    expect(full).toBeGreaterThanOrEqual(1800);
    expect(full).toBeLessThanOrEqual(2800);
    expect(run(TIMELINES.reduced, () => true)).toBeLessThanOrEqual(300);
  });

  it('the CSS-driven return visit is 0.6–0.9 s and matches the stylesheet', () => {
    const goneAt = RETURN_SEQUENCE.fadeStartMs + RETURN_SEQUENCE.fadeMs;
    expect(goneAt).toBeGreaterThanOrEqual(600);
    expect(goneAt).toBeLessThanOrEqual(900);
    expect(RETURN_SEQUENCE.signalMs).toBeLessThan(RETURN_SEQUENCE.fadeStartMs);
    const css = readFileSync('src/app/globals.css', 'utf8');
    const value = (name: string): number =>
      Number(new RegExp(String.raw`${name}:\s*(\d+)ms`).exec(css)?.[1]);
    expect(value('--boot-return-signal')).toBe(RETURN_SEQUENCE.signalMs);
    expect(value('--boot-return-fade-start')).toBe(RETURN_SEQUENCE.fadeStartMs);
    expect(value('--boot-return-fade')).toBe(RETURN_SEQUENCE.fadeMs);
  });

  it('shortens the sequence once the data is ready', () => {
    const neverReady = run(TIMELINES.full, () => false);
    const readyEarly = run(TIMELINES.full, () => true);
    expect(readyEarly).toBeLessThan(neverReady);
  });

  it('waits at the hold point for real readiness, but never past the cap', () => {
    const tl = TIMELINES.full;
    const frame = 1000 / 60;
    /** Real time at which the clock moves past the hold point. */
    const releasedAt = (ready: (real: number) => boolean): number => {
      let clock = startClock(tl);
      while (clock.t <= tl.holdAt && !clock.done)
        clock = advanceClock(tl, clock, frame, ready(clock.real));
      return clock.real;
    };
    // Readiness is sampled once a frame, so "then" means within two frames.
    const within = (actual: number, target: number): void => {
      expect(actual).toBeGreaterThanOrEqual(target);
      expect(actual).toBeLessThanOrEqual(target + 2 * frame);
    };
    // Data lands at 1.75 s, while the clock is holding: it moves on then.
    within(
      releasedAt(real => real >= 1750),
      1750,
    );
    // Data never lands: the cap releases it at 1.85 s.
    within(
      releasedAt(() => false),
      tl.holdLimitMs,
    );
    expect(run(tl, () => false)).toBeLessThanOrEqual(
      tl.holdLimitMs + (tl.end - tl.holdAt) + 2 * frame,
    );
  });

  it('counts time already spent on the server-rendered opening frame', () => {
    const tl = TIMELINES.full;
    const firstBeat = tl.beats.signal![0];
    expect(startClock(tl, 5000).t).toBe(firstBeat);
    expect(startClock(tl, 100).t).toBe(100);
    // Reduced motion absorbs none (it has nothing to skip).
    expect(startClock(TIMELINES.reduced, 5000).t).toBe(0);
    // 200 ms of hydration is part of the sequence, not added to it.
    expect(Math.abs(run(tl, () => true, 200) - run(tl, () => true, 0))).toBeLessThan(
      2 * (1000 / 60),
    );
  });

  it('does not jump when a backgrounded tab resumes', () => {
    const tl = TIMELINES.full;
    const after = advanceClock(tl, startClock(tl), 10_000, true);
    expect(after.real).toBe(MAX_STEP_MS);
  });

  it('skips straight to the hand-off on user input', () => {
    const tl = TIMELINES.full;
    const skipped = skipClock(tl, startClock(tl));
    expect(skipped.t).toBe(tl.beats.handoff![0]);
    expect(currentBeat(tl, skipped.t)).toBe('handoff');
    expect(skipClock(tl, skipped)).toBe(skipped);
  });

  it('reports beats and their progress', () => {
    const tl = TIMELINES.full;
    expect(currentBeat(tl, 0)).toBe('frame');
    expect(currentBeat(tl, tl.beats.grid![0] + 1)).toBe('grid');
    expect(currentBeat(tl, tl.end)).toBe('done');
    const [a, b] = tl.beats.sweep!;
    expect(beatProgress(tl, 'sweep', a)).toBe(0);
    expect(beatProgress(tl, 'sweep', (a + b) / 2)).toBeCloseTo(0.5);
    expect(beatProgress(tl, 'sweep', b + 1)).toBe(1);
    expect(beatProgress(TIMELINES.reduced, 'sweep', 500)).toBe(0);
  });
});

describe('status line', () => {
  it('follows the real stages of start-up', () => {
    expect(actualStage({ feedStarted: false, universeLoaded: false, synced: false })).toBe(
      'connecting',
    );
    expect(actualStage({ feedStarted: true, universeLoaded: false, synced: false })).toBe(
      'loading',
    );
    expect(actualStage({ feedStarted: true, universeLoaded: true, synced: false })).toBe('syncing');
    expect(actualStage({ feedStarted: true, universeLoaded: true, synced: true })).toBe('ready');
  });

  it('is paced for reading but never claims more than is true', () => {
    const tl = TIMELINES.full;
    expect(displayedStage(tl, 0, 'ready')).toBe('connecting');
    expect(displayedStage(tl, tl.stageAt.ready, 'ready')).toBe('ready');
    expect(displayedStage(tl, tl.end, 'loading')).toBe('loading');
    expect(stageLabel('ready', '5,247')).toEqual({ glyph: '●', text: '5,247 securities ready' });
    expect(stageLabel('connecting', 'x').glyph).toBe('○');
    expect(stageLabel('syncing', 'x').glyph).toBe('◐');
  });

  it('eases monotonically from 0 to 1', () => {
    for (const ease of [easeOutCubic, easeInOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(-1)).toBe(0);
      expect(ease(0.6)).toBeGreaterThan(ease(0.4));
    }
  });
});

describe('boot input', () => {
  it('uses only real figures from the session snapshot', () => {
    const overview = buildOverview(market(300));
    const input = bootInputFromOverview(overview);
    expect(input.securities).toBe(overview.breadth.total);
    expect(input.readouts.map(r => r.label)).toEqual([
      'NIFTY 50',
      'SENSEX',
      'BANK NIFTY',
      'NIFTY IT',
    ]);
    expect(input.readouts[0]!.value).toBe(overview.indices.find(i => i.id === 'NIFTY50')!.value);
    expect(input.sectors.reduce((s, x) => s + x.count, 0)).toBe(overview.breadth.total);
    expect(input.meta[0]).toBe('300 securities');
    expect(input.trace.length).toBeGreaterThan(1);
  });
});
