import { clamp01, easeInOutCubic, easeOutCubic } from '@/lib/boot';

/**
 * Canvas layer of the boot sequence: the signal cross, the securities coming
 * online, the grid they settle into, and the sweep that resolves them.
 *
 * Nothing here is decorative noise. Each dot is a security (one dot per
 * security on desktop; on small screens one dot stands for a few). Dots are
 * laid out sector by sector, and once the sweep passes they take their
 * sector's real advance / decline split from the snapshot, so the resolved
 * grid is a true picture of the session's breadth.
 *
 * The scene is built once per viewport size; `drawIntro` is a pure function
 * of the scene and the beat progress values, so a frame costs a few thousand
 * fillRects and no allocation.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SectorTone {
  count: number;
  advancing: number;
  declining: number;
}

export interface SceneInput {
  width: number;
  height: number;
  securities: number;
  sectors: readonly SectorTone[];
  /** An index's intraday path (raw levels), drawn as the sweep passes. */
  trace: readonly number[];
  readoutRows: number;
  seed?: number;
}

export interface IntroScene {
  width: number;
  height: number;
  origin: { x: number; y: number };
  /** Centre of the wordmark while the system comes online. */
  titleY: number;
  /** Aligned readouts sit here once the grid forms. */
  header: Rect;
  grid: Rect;
  traceBand: Rect;
  /** Aligned meta fragments sit here. */
  footer: Rect;
  cols: number;
  rows: number;
  count: number;
  /** Scattered position, grid slot, appearance order (0–1) and tone per dot. */
  sx: Float32Array;
  sy: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  appear: Float32Array;
  tone: Int8Array;
  /** Horizontal rules at sector boundaries, vertical rules every few columns. */
  rowRules: number[];
  colRules: number[];
  trace: Float32Array;
}

export interface IntroFrame {
  signal: number;
  points: number;
  grid: number;
  sweep: number;
  compress: number;
}

export interface IntroColors {
  ink: string;
  faint: string;
  muted: string;
  line: string;
  positive: string;
  negative: string;
}

/** Small deterministic PRNG: the same viewport always gets the same scene. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOT = 2;

export function buildScene(input: SceneInput): IntroScene {
  const { width, height } = input;
  const rand = mulberry32(input.seed ?? 5247);
  const narrow = width < 640;

  // Grid geometry: an 8 px pitch on desktop, 6 px on phones, capped in height.
  const gutter = narrow ? 20 : 64;
  const pitchX = narrow ? 6 : 8;
  const pitchY = 6;
  const cols = Math.max(20, Math.floor(Math.min(1040, width - gutter * 2) / pitchX));
  const maxRows = Math.max(14, Math.min(42, Math.floor((height * 0.3) / pitchY)));
  const count = Math.max(1, Math.min(input.securities, cols * maxRows));
  const rows = Math.ceil(count / cols);
  const gridW = cols * pitchX;
  const gridH = rows * pitchY;

  // Vertical composition: title, readouts, grid, trace, meta.
  const titleH = 64;
  const headerH = input.readoutRows * 18;
  const traceH = 26;
  const footerH = 16;
  const stack = titleH + 26 + headerH + 14 + gridH + 16 + traceH + 12 + footerH;
  const top = Math.max(24, (height - stack) / 2 - 12);
  const left = (width - gridW) / 2;
  const titleY = top + titleH / 2;
  const header: Rect = { x: left, y: top + titleH + 26, w: gridW, h: headerH };
  const grid: Rect = { x: left, y: header.y + headerH + 14, w: gridW, h: gridH };
  const traceBand: Rect = { x: left, y: grid.y + gridH + 16, w: gridW, h: traceH };
  const footer: Rect = { x: left, y: traceBand.y + traceH + 12, w: gridW, h: footerH };
  const origin = { x: Math.round(width / 2), y: Math.round(grid.y + gridH / 2) };

  // Tones: sectors fill the grid in order; within each sector the real
  // advancing / declining shares are shuffled so it reads as a heat field.
  const tone = new Int8Array(count);
  const totalSecurities = input.sectors.reduce((s, x) => s + x.count, 0) || 1;
  const rowRules: number[] = [];
  let cursor = 0;
  input.sectors.forEach((sector, si) => {
    const n =
      si === input.sectors.length - 1
        ? count - cursor
        : Math.round((sector.count / totalSecurities) * count);
    const span = Math.max(0, Math.min(n, count - cursor));
    const adv = Math.round((sector.advancing / (sector.count || 1)) * span);
    const dec = Math.round((sector.declining / (sector.count || 1)) * span);
    const slice: number[] = [];
    for (let k = 0; k < span; k++) slice.push(k < adv ? 1 : k < adv + dec ? -1 : 0);
    for (let k = slice.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [slice[k], slice[j]] = [slice[j]!, slice[k]!];
    }
    for (let k = 0; k < span; k++) tone[cursor + k] = slice[k]!;
    cursor += span;
    const boundaryRow = Math.round(cursor / cols);
    if (cursor < count && boundaryRow > 0 && boundaryRow < rows) {
      const y = Math.round(grid.y + boundaryRow * pitchY) - 0.5;
      if (rowRules[rowRules.length - 1] !== y) rowRules.push(y);
    }
  });

  const colRules: number[] = [];
  const colStep = narrow ? 8 : 10;
  for (let c = colStep; c < cols; c += colStep)
    colRules.push(Math.round(grid.x + c * pitchX) - 0.5);

  // Dots: scattered on a 16 px lattice (structured, not floating), appearing
  // from the signal outward; each has a fixed slot in the grid.
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const gx = new Float32Array(count);
  const gy = new Float32Array(count);
  const appear = new Float32Array(count);
  const lattice = 16;
  const maxDist = Math.hypot(width / 2, height / 2);
  const titleTop = titleY - 40;
  const titleBottom = titleY + 40;
  for (let i = 0; i < count; i++) {
    let x = Math.round((24 + rand() * (width - 48)) / lattice) * lattice;
    let y = Math.round((24 + rand() * (height - 48)) / lattice) * lattice;
    // Keep the wordmark clear.
    if (y > titleTop && y < titleBottom && Math.abs(x - width / 2) < 260) y = titleBottom + lattice;
    x = Math.min(width - 16, Math.max(16, x));
    sx[i] = x;
    sy[i] = y;
    gx[i] = grid.x + (i % cols) * pitchX + (pitchX - DOT) / 2;
    gy[i] = grid.y + Math.floor(i / cols) * pitchY + (pitchY - DOT) / 2;
    const d = Math.hypot(x - origin.x, y - origin.y) / maxDist;
    appear[i] = clamp01(0.65 * d + 0.35 * rand());
  }

  // Index trace normalised into its band.
  const trace = new Float32Array(input.trace.length * 2);
  if (input.trace.length > 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of input.trace) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const span = hi - lo || 1;
    input.trace.forEach((v, i) => {
      trace[i * 2] = traceBand.x + (i / (input.trace.length - 1)) * traceBand.w;
      trace[i * 2 + 1] = traceBand.y + 2 + (1 - (v - lo) / span) * (traceBand.h - 4);
    });
  }

  return {
    width,
    height,
    origin,
    titleY,
    header,
    grid,
    traceBand,
    footer,
    cols,
    rows,
    count,
    sx,
    sy,
    gx,
    gy,
    appear,
    tone,
    rowRules,
    colRules,
    trace,
  };
}

/** x of the sweep line for a sweep progress, or -Infinity before it starts. */
export function sweepX(scene: IntroScene, sweep: number): number {
  if (sweep <= 0) return -Infinity;
  return scene.grid.x - 24 + (scene.grid.w + 48) * easeInOutCubic(sweep);
}

export function drawIntro(
  ctx: CanvasRenderingContext2D,
  scene: IntroScene,
  f: IntroFrame,
  c: IntroColors,
): void {
  const { width, height, origin, grid } = scene;
  ctx.clearRect(0, 0, width, height);
  const keep = 1 - easeInOutCubic(f.compress);
  if (keep <= 0.001) return;
  const g = easeInOutCubic(f.grid);
  const sx = sweepX(scene, f.sweep);

  // 1. The first signal: a point, then hairlines racing out. As the grid
  //    forms the cross hands over to the grid's own rules.
  if (f.signal > 0) {
    const k = easeOutCubic(f.signal);
    const crossAlpha = (1 - g) * keep;
    if (crossAlpha > 0.01) {
      ctx.fillStyle = c.line;
      ctx.globalAlpha = crossAlpha;
      const hx = k * (width / 2);
      ctx.fillRect(origin.x - hx, origin.y, hx * 2, 1);
      const vy = k * (height / 2);
      const clearTop = scene.titleY + 34;
      const top = Math.max(origin.y - vy, clearTop);
      if (top < origin.y) ctx.fillRect(origin.x, top, 1, origin.y - top);
      ctx.fillRect(origin.x, origin.y, 1, vy);
    }
    ctx.globalAlpha = keep * (1 - g * 0.6);
    ctx.fillStyle = c.ink;
    const r = 1.5 + (1 - k) * 1.5;
    ctx.fillRect(origin.x - r + 0.5, origin.y - r + 0.5, r * 2, r * 2);
  }

  // 2. Rows and columns: rules grow out from the centre as the dots align.
  if (g > 0) {
    ctx.fillStyle = c.line;
    const halfW = (grid.w / 2 + 12) * g * keep;
    const halfH = (grid.h / 2 + 8) * g * keep;
    const cy = grid.y + grid.h / 2;
    ctx.globalAlpha = 0.9 * keep;
    ctx.fillRect(origin.x - halfW, Math.round(grid.y - 8) - 0.5, halfW * 2, 1);
    ctx.fillRect(origin.x - halfW, Math.round(grid.y + grid.h + 8) - 0.5, halfW * 2, 1);
    ctx.globalAlpha = 0.55 * keep;
    for (const y of scene.rowRules) ctx.fillRect(origin.x - halfW, y, halfW * 2, 1);
    for (const x of scene.colRules) {
      const a = x - origin.x;
      ctx.fillRect(origin.x + a * g * keep, cy - halfH, 1, halfH * 2);
    }
  }

  // 3. Securities: appear, align row by row, then resolve under the sweep.
  if (f.points > 0) {
    const { count, cols, rows, sx: px, sy: py, gx, gy, appear, tone } = scene;
    const cx = origin.x;
    const cy = origin.y;
    const ck = easeInOutCubic(f.compress);
    // One pass per colour keeps fillStyle changes to four per frame.
    for (let pass = 0; pass < 4; pass++) {
      ctx.fillStyle =
        pass === 0 ? c.faint : pass === 1 ? c.positive : pass === 2 ? c.negative : c.muted;
      for (let i = 0; i < count; i++) {
        const shown = (f.points - appear[i]! * 0.85) / 0.15;
        if (shown <= 0) continue;
        const row = Math.floor(i / cols);
        const gp = easeInOutCubic((f.grid - (row / rows) * 0.35) / 0.65);
        const resolved = gp >= 1 && gx[i]! < sx;
        const t = tone[i]!;
        const want = !resolved ? 0 : t > 0 ? 1 : t < 0 ? 2 : 3;
        if (want !== pass) continue;
        let x = px[i]! + (gx[i]! - px[i]!) * gp;
        let y = py[i]! + (gy[i]! - py[i]!) * gp;
        if (ck > 0) {
          x += (cx - x) * ck;
          y += (cy - y) * ck;
        }
        ctx.globalAlpha = Math.min(1, shown) * keep * (resolved ? 0.9 : 0.55);
        ctx.fillRect(x, y, DOT, DOT);
      }
    }
  }

  // 4. The sweep: one hairline with a faint trailing tint, no glow.
  if (f.sweep > 0 && f.sweep < 1) {
    ctx.fillStyle = c.ink;
    for (let s = 0; s < 6; s++) {
      ctx.globalAlpha = 0.012 * (s + 1) * keep;
      ctx.fillRect(sx - 36 + s * 6, grid.y - 8, 6, grid.h + 16);
    }
    ctx.globalAlpha = 0.7 * keep;
    ctx.fillRect(Math.round(sx) - 0.5, grid.y - 14, 1, grid.h + 28);
  }

  // 5. The chart resolves behind the sweep.
  const pts = scene.trace;
  if (f.sweep > 0 && pts.length >= 4) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      scene.traceBand.x - 2,
      scene.traceBand.y - 4,
      Math.max(0, sx - scene.traceBand.x + 2),
      scene.traceBand.h + 8,
    );
    ctx.clip();
    ctx.globalAlpha = 0.85 * keep;
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}
