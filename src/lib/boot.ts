/**
 * First-load boot sequence: visit logic, timeline and pacing.
 *
 * Pure and DOM-free so the pacing rules are unit-tested:
 * - the sequence never waits on visuals: it holds at one point only, and only
 *   until the market data is genuinely ready (or a hard real-time cap passes);
 * - once the data is ready the clock runs faster, so a fast load shortens the
 *   sequence instead of padding it;
 * - the status line never claims a stage the app has not actually reached.
 *
 * Modes:
 *   full     first visit to the home page (~2.2–2.6 s including page load)
 *   return   later visits: pure CSS from first paint (~0.66 s), so it never
 *            waits for JavaScript to start
 *   reduced  first visit with prefers-reduced-motion: static frame, opacity only
 *   none     deep links, client-side navigations, reduced-motion return visits
 */

export type IntroMode = 'full' | 'return' | 'reduced' | 'none';
export type ActiveIntroMode = Exclude<IntroMode, 'none'>;
/** Modes the script-driven sequence plays; the return visit is CSS only. */
export type TimedIntroMode = Exclude<ActiveIntroMode, 'return'>;

/**
 * The return-visit sequence, run by CSS animations from the first paint
 * (globals.css, "Boot sequence — return visit"). These values mirror the CSS
 * custom properties of the same names; a test keeps the two in step.
 */
export const RETURN_SEQUENCE = {
  /** --boot-return-signal: hairlines draw out from the wordmark. */
  signalMs: 300,
  /** --boot-return-fade-start: the overlay starts fading. */
  fadeStartMs: 360,
  /** --boot-return-fade: fade length; the overlay is gone at start + this. */
  fadeMs: 300,
  /** Settle time for the page's staggered entrance after the fade starts. */
  emergeTailMs: 1100,
} as const;

export const INTRO_STORAGE_KEY = 'ep:intro';

export function resolveIntroMode(input: {
  pathname: string;
  seen: boolean;
  reducedMotion: boolean;
}): IntroMode {
  if (input.pathname !== '/') return 'none';
  if (input.reducedMotion) return input.seen ? 'none' : 'reduced';
  return input.seen ? 'return' : 'full';
}

/** If the app has not started the sequence by then (slow or failed JavaScript), it is cancelled. */
export const INTRO_FAILSAFE_MS = 6000;

/**
 * Runs in <head> before first paint and mirrors `resolveIntroMode` (a test
 * keeps the two in step). The overlay is hidden by CSS unless this script
 * sets an active mode, so without JavaScript the page is never covered; the
 * failsafe uncovers it if the app never takes over.
 */
export const INTRO_BOOT_SCRIPT = `(function(){var d=document.documentElement;try{var s=null;try{s=localStorage.getItem('${INTRO_STORAGE_KEY}')}catch(e){}var r=window.matchMedia('(prefers-reduced-motion: reduce)').matches;d.dataset.intro=location.pathname!=='/'?'none':r?(s?'none':'reduced'):(s?'return':'full');if(d.dataset.intro!=='none')setTimeout(function(){if(!window.__epBoot)d.dataset.intro='none';},${INTRO_FAILSAFE_MS});}catch(e){d.dataset.intro='none';}})();`;

/** Set by the boot sequence when it takes over from the head script. */
export const BOOT_FLAG = '__epBoot';

/** Hydration slower than this downgrades a first visit to the short sequence. */
export const SLOW_START_MS = 2500;

/** Records that the full sequence has been seen; later visits get the short one. */
export function markIntroSeen(
  storage: Pick<Storage, 'setItem'> | undefined,
  now = Date.now(),
): void {
  try {
    storage?.setItem(INTRO_STORAGE_KEY, JSON.stringify({ seen: now, v: 1 }));
  } catch {
    // Storage disabled: the visitor simply sees the full sequence again.
  }
}

/* ------------------------------------------------------------------------ */
/* Timeline                                                                 */
/* ------------------------------------------------------------------------ */

export type Beat =
  'signal' | 'points' | 'fragments' | 'grid' | 'sweep' | 'compress' | 'reveal' | 'handoff';

export interface Timeline {
  mode: TimedIntroMode;
  /** Virtual-ms windows for each beat. Beats a mode skips are absent. */
  beats: Partial<Record<Beat, readonly [number, number]>>;
  /** The one point where the sequence waits for real readiness. */
  holdAt: number;
  /** Real ms after which the hold is released even if data is not ready. */
  holdLimitMs: number;
  /** Clock speed once the data is ready (> 1 shortens the remaining sequence). */
  readyRate: number;
  /**
   * How much time spent loading (with the server-rendered opening frame on
   * screen) the sequence absorbs: it starts that far in. The full sequence
   * keeps every beat; the short one may skip straight to its hold point.
   */
  catchUpMs: number;
  end: number;
  /** Earliest virtual ms at which each status stage may be shown. */
  stageAt: Record<BootStage, number>;
}

export const TIMELINES: Record<TimedIntroMode, Timeline> = {
  full: {
    mode: 'full',
    beats: {
      signal: [220, 600],
      points: [350, 1050],
      fragments: [480, 1250],
      grid: [1000, 1420],
      sweep: [1360, 1700],
      compress: [1720, 1920],
      // Headline in by 2120, then a 250 ms stillness before the hand-off.
      reveal: [1920, 2120],
      handoff: [2370, 2720],
    },
    holdAt: 1700,
    holdLimitMs: 1850,
    readyRate: 1.25,
    catchUpMs: 220,
    end: 2720,
    stageAt: { connecting: 0, loading: 420, syncing: 860, ready: 1300 },
  },
  reduced: {
    mode: 'reduced',
    // Holds on the static frame, then a plain cross-fade.
    beats: { handoff: [10, 230] },
    holdAt: 0,
    holdLimitMs: 600,
    readyRate: 1,
    catchUpMs: 0,
    end: 230,
    stageAt: { connecting: 0, loading: 0, syncing: 0, ready: 0 },
  },
};

export interface Clock {
  /** Virtual time (ms) — what the beats are expressed in. */
  t: number;
  /** Real time elapsed (ms). */
  real: number;
  /** Waiting at the hold point for readiness. */
  held: boolean;
  done: boolean;
}

/** Longest frame step honoured; a backgrounded tab resumes, it does not jump. */
export const MAX_STEP_MS = 64;

export function startClock(tl: Timeline, elapsedBeforeStartMs = 0): Clock {
  // Time already spent showing the server-rendered opening frame (while the
  // page hydrated) counts toward the sequence, up to its catch-up allowance.
  const t = Math.max(0, Math.min(elapsedBeforeStartMs, tl.catchUpMs, tl.holdAt));
  return { t, real: t, held: false, done: tl.end <= t };
}

export function advanceClock(tl: Timeline, clock: Clock, dtMs: number, ready: boolean): Clock {
  if (clock.done) return clock;
  const dt = Math.max(0, Math.min(dtMs, MAX_STEP_MS));
  const real = clock.real + dt;
  const release = ready || real >= tl.holdLimitMs;
  let t = clock.t + dt * (ready ? tl.readyRate : 1);
  let held = false;
  if (!release && t >= tl.holdAt && clock.t <= tl.holdAt) {
    t = tl.holdAt;
    held = true;
  }
  t = Math.min(t, tl.end);
  return { t, real, held, done: t >= tl.end };
}

/** Jumps to the hand-off (user pressed a key or clicked). */
export function skipClock(tl: Timeline, clock: Clock): Clock {
  const handoff = tl.beats.handoff![0];
  return clock.t >= handoff ? clock : { ...clock, t: handoff, held: false };
}

/** 0 → 1 progress through a beat; 0 for beats the timeline does not have. */
export function beatProgress(tl: Timeline, beat: Beat, t: number): number {
  const w = tl.beats[beat];
  if (!w) return 0;
  const [a, b] = w;
  if (t <= a) return 0;
  if (t >= b) return 1;
  return (t - a) / (b - a);
}

/** The latest beat that has started — drives the overlay's CSS states. */
export function currentBeat(tl: Timeline, t: number): Beat | 'frame' | 'done' {
  if (t >= tl.end) return 'done';
  let current: Beat | 'frame' = 'frame';
  let start = -1;
  for (const [beat, w] of Object.entries(tl.beats) as [Beat, readonly [number, number]][]) {
    if (t >= w[0] && w[0] >= start) {
      current = beat;
      start = w[0];
    }
  }
  return current;
}

/* ------------------------------------------------------------------------ */
/* Status line                                                              */
/* ------------------------------------------------------------------------ */

export type BootStage = 'connecting' | 'loading' | 'syncing' | 'ready';

const STAGES: readonly BootStage[] = ['connecting', 'loading', 'syncing', 'ready'];

/** Where the app really is. */
export function actualStage(state: {
  feedStarted: boolean;
  universeLoaded: boolean;
  synced: boolean;
}): BootStage {
  if (state.universeLoaded && state.synced) return 'ready';
  if (state.universeLoaded) return 'syncing';
  if (state.feedStarted) return 'loading';
  return 'connecting';
}

/** What to show: real progress, paced so each stage is readable — never ahead of reality. */
export function displayedStage(tl: Timeline, t: number, actual: BootStage): BootStage {
  let paced = 0;
  STAGES.forEach((stage, i) => {
    if (t >= tl.stageAt[stage]) paced = i;
  });
  return STAGES[Math.min(paced, STAGES.indexOf(actual))]!;
}

export function stageLabel(stage: BootStage, securities: string): { glyph: string; text: string } {
  switch (stage) {
    case 'connecting':
      return { glyph: '○', text: 'Connecting to market engine' };
    case 'loading':
      return { glyph: '◐', text: 'Loading market universe' };
    case 'syncing':
      return { glyph: '◐', text: 'Syncing live data' };
    case 'ready':
      return { glyph: '●', text: `${securities} securities ready` };
  }
}

/* ------------------------------------------------------------------------ */
/* Easing                                                                   */
/* ------------------------------------------------------------------------ */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOutCubic = (p: number): number => 1 - (1 - clamp01(p)) ** 3;
export const easeInOutCubic = (p: number): number => {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
