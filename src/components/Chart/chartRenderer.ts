import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import type { Candle } from '@/types/market';
import {
  lastValue,
  OVERLAY_IDS,
  visibleProfile,
  type ChartModel,
  type IndicatorId,
  type LinePoint,
  type OverlayId,
} from '@/lib/chartData';
import { formatNumber } from '@/lib/format';
import { VolumeProfilePrimitive } from './volumeProfilePrimitive';

/**
 * Imperative wrapper around Lightweight Charts. React owns state; this class
 * owns the canvas: series lifecycle, panes, theme, crosshair reporting and
 * cleanup. Panes: 0 = price (candles, averages, bands, volume profile),
 * 1 = volume, 2 = RSI (created only while RSI is enabled). Every measure has
 * its own pane and scale — no dual axes.
 */

export interface ChartTheme {
  background: string;
  text: string;
  muted: string;
  grid: string;
  border: string;
  crosshair: string;
  up: string;
  down: string;
  series: Record<IndicatorId, string>;
  band: string;
  font: string;
}

export function readChartTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string): string => css.getPropertyValue(name).trim();
  return {
    background: v('--surface'),
    text: v('--text-2'),
    muted: v('--text-muted'),
    grid: v('--chart-grid'),
    border: v('--border'),
    crosshair: v('--text-faint'),
    up: v('--candle-up'),
    down: v('--candle-down'),
    series: {
      sma20: v('--series-1'),
      sma50: v('--series-2'),
      sma200: v('--series-3'),
      ema12: v('--series-4'),
      ema26: v('--series-5'),
      bb: v('--series-6'),
      rsi: v('--series-1'),
      vp: v('--text-muted'),
    },
    band: v('--series-band'),
    font: css.getPropertyValue('--font-geist-mono').trim() || 'ui-monospace, monospace',
  };
}

export interface CrosshairInfo {
  candle: Candle;
  change: number;
  changePercent: number;
  values: Partial<Record<IndicatorId | 'bbUpper' | 'bbLower', number>>;
  hovering: boolean;
}

const withAlpha = (color: string, alpha: number): string => {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export class ChartController {
  private readonly chart: IChartApi;
  private readonly candles: ISeriesApi<'Candlestick'>;
  private readonly volume: ISeriesApi<'Histogram'>;
  private readonly overlays = new Map<OverlayId, ISeriesApi<'Line'>>();
  private readonly bands: {
    upper: ISeriesApi<'Line'>;
    middle: ISeriesApi<'Line'>;
    lower: ISeriesApi<'Line'>;
  };
  private rsi: ISeriesApi<'Line'> | null = null;
  private rsiLines: IPriceLine[] = [];
  private readonly profile = new VolumeProfilePrimitive();
  private model: ChartModel | null = null;
  private enabled = new Set<IndicatorId>();
  private theme: ChartTheme;
  private profileFrame: number | null = null;
  private visibleBars: number | null = null;

  constructor(
    private readonly container: HTMLElement,
    theme: ChartTheme,
    private readonly onCrosshair: (info: CrosshairInfo | null) => void,
  ) {
    this.theme = theme;
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
        textColor: theme.muted,
        fontFamily: theme.font,
        fontSize: 11,
        attributionLogo: false,
        panes: {
          separatorColor: theme.border,
          separatorHoverColor: theme.grid,
          enableResize: true,
        },
      },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: theme.crosshair,
          width: 1,
          style: LineStyle.Solid,
          labelBackgroundColor: theme.text,
        },
        horzLine: {
          color: theme.crosshair,
          width: 1,
          style: LineStyle.Solid,
          labelBackgroundColor: theme.text,
        },
      },
      rightPriceScale: { borderColor: theme.border, scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: {
        borderColor: theme.border,
        rightOffset: 4,
        barSpacing: 7,
        minBarSpacing: 1.5,
        timeVisible: true,
        secondsVisible: false,
      },
      localization: { locale: 'en-IN', priceFormatter: (p: number) => formatNumber(p, 2) },
    });

    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: theme.up,
      downColor: theme.down,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Solid,
      priceLineColor: theme.crosshair,
    });
    this.candles.attachPrimitive(this.profile);

    for (const id of OVERLAY_IDS) {
      this.overlays.set(
        id,
        this.chart.addSeries(LineSeries, {
          color: theme.series[id],
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        }),
      );
    }
    const band = (lineWidth: 1 | 2): ISeriesApi<'Line'> =>
      this.chart.addSeries(LineSeries, {
        color: theme.series.bb,
        lineWidth,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: false,
      });
    this.bands = { upper: band(1), middle: band(1), lower: band(1) };
    this.bands.middle.applyOptions({
      lineStyle: LineStyle.Solid,
      color: withAlpha(theme.series.bb, 0.55),
    });

    this.volume = this.chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      1,
    );

    this.chart.subscribeCrosshairMove(this.handleCrosshair);
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this.scheduleProfile);
    this.layoutPanes();
  }

  /* --------------------------------------------------------------- data */

  setModel(model: ChartModel, visibleBars: number | null): void {
    this.model = model;
    this.visibleBars = visibleBars;
    const t = (time: string | number): Time => time as Time;
    this.candles.setData(
      model.candles.map((c, i) => ({
        time: t(model.times[i]!),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    this.volume.setData(
      model.candles.map((c, i) => ({
        time: t(model.times[i]!),
        value: c.volume,
        color: withAlpha(c.close >= c.open ? this.theme.up : this.theme.down, 0.42),
      })),
    );
    for (const id of OVERLAY_IDS) this.overlays.get(id)!.setData(this.points(model.overlays[id]));
    this.bands.upper.setData(this.points(model.bands.upper));
    this.bands.middle.setData(this.points(model.bands.middle));
    this.bands.lower.setData(this.points(model.bands.lower));
    this.rsi?.setData(this.points(model.rsi));
    this.resetView();
    this.emitLast();
  }

  private points(points: readonly LinePoint[]) {
    return points.map(p => ({ time: p.time as Time, value: p.value }));
  }

  /** Pushes the last bar (and the last indicator values) after a live tick. */
  updateLast(model: ChartModel, appended: boolean): void {
    this.model = model;
    const i = model.candles.length - 1;
    const c = model.candles[i];
    if (!c) return;
    const time = model.times[i] as Time;
    this.candles.update({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    this.volume.update({
      time,
      value: c.volume,
      color: withAlpha(c.close >= c.open ? this.theme.up : this.theme.down, 0.42),
    });
    const last = (points: LinePoint[], series: ISeriesApi<'Line'> | null): void => {
      const p = points[points.length - 1];
      if (series && p && p.time === model.times[i])
        series.update({ time: p.time as Time, value: p.value });
    };
    for (const id of OVERLAY_IDS) last(model.overlays[id], this.overlays.get(id)!);
    last(model.bands.upper, this.bands.upper);
    last(model.bands.middle, this.bands.middle);
    last(model.bands.lower, this.bands.lower);
    last(model.rsi, this.rsi);
    if (appended) this.scheduleProfile();
    this.emitLast();
  }

  /* --------------------------------------------------------- indicators */

  setEnabled(enabled: ReadonlySet<IndicatorId>): void {
    this.enabled = new Set(enabled);
    for (const id of OVERLAY_IDS) this.overlays.get(id)!.applyOptions({ visible: enabled.has(id) });
    const bb = enabled.has('bb');
    this.bands.upper.applyOptions({ visible: bb });
    this.bands.middle.applyOptions({ visible: bb });
    this.bands.lower.applyOptions({ visible: bb });

    if (enabled.has('rsi') && !this.rsi) {
      this.rsi = this.chart.addSeries(
        LineSeries,
        {
          color: this.theme.series.rsi,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          priceFormat: { type: 'custom', formatter: (v: number) => v.toFixed(1), minMove: 0.1 },
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        },
        2,
      );
      if (this.model) this.rsi.setData(this.points(this.model.rsi));
      this.rsiLines = [70, 30].map(level =>
        this.rsi!.createPriceLine({
          price: level,
          color: this.theme.crosshair,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: level === 70 ? 'Overbought' : 'Oversold',
        }),
      );
    } else if (!enabled.has('rsi') && this.rsi) {
      this.chart.removeSeries(this.rsi);
      this.rsi = null;
      this.rsiLines = [];
      if (this.chart.panes().length > 2) this.chart.removePane(2);
    }
    this.layoutPanes();
    this.scheduleProfile();
    this.emitLast();
  }

  private layoutPanes(): void {
    const height = this.container.clientHeight || 480;
    const panes = this.chart.panes();
    const volume = Math.round(height * 0.14);
    const rsi = this.rsi ? Math.round(height * 0.2) : 0;
    panes[1]?.setHeight(volume);
    panes[2]?.setHeight(rsi);
    panes[0]?.setHeight(height - volume - rsi);
  }

  resize(): void {
    this.layoutPanes();
  }

  /* ------------------------------------------------------------- view */

  resetView(): void {
    const n = this.model?.candles.length ?? 0;
    if (!n) return;
    const ts = this.chart.timeScale();
    if (this.visibleBars && n > this.visibleBars) {
      ts.setVisibleLogicalRange({ from: n - this.visibleBars - 0.5, to: n - 1 + 3 });
    } else {
      ts.fitContent();
    }
  }

  zoom(factor: number): void {
    const ts = this.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const span = range.to - range.from;
    const center = range.to - span * 0.25;
    const next = Math.max(10, span * factor);
    ts.setVisibleLogicalRange({ from: center - next * 0.75, to: center + next * 0.25 });
  }

  pan(bars: number): void {
    const ts = this.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (range) ts.setVisibleLogicalRange({ from: range.from + bars, to: range.to + bars });
  }

  /* ------------------------------------------------------------ theme */

  applyTheme(theme: ChartTheme): void {
    this.theme = theme;
    this.chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: theme.background },
        textColor: theme.muted,
        panes: { separatorColor: theme.border, separatorHoverColor: theme.grid },
      },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      crosshair: {
        vertLine: { color: theme.crosshair, labelBackgroundColor: theme.text },
        horzLine: { color: theme.crosshair, labelBackgroundColor: theme.text },
      },
      rightPriceScale: { borderColor: theme.border },
      timeScale: { borderColor: theme.border },
    });
    this.candles.applyOptions({
      upColor: theme.up,
      downColor: theme.down,
      borderUpColor: theme.up,
      borderDownColor: theme.down,
      wickUpColor: theme.up,
      wickDownColor: theme.down,
      priceLineColor: theme.crosshair,
    });
    for (const id of OVERLAY_IDS) this.overlays.get(id)!.applyOptions({ color: theme.series[id] });
    this.bands.upper.applyOptions({ color: theme.series.bb });
    this.bands.lower.applyOptions({ color: theme.series.bb });
    this.bands.middle.applyOptions({ color: withAlpha(theme.series.bb, 0.55) });
    this.rsi?.applyOptions({ color: theme.series.rsi });
    this.rsiLines.forEach(line => line.applyOptions({ color: theme.crosshair }));
    if (this.model) this.setModel(this.model, this.visibleBars);
    this.scheduleProfile();
  }

  /* ---------------------------------------------------- volume profile */

  private scheduleProfile = (): void => {
    if (this.profileFrame !== null) return;
    this.profileFrame = requestAnimationFrame(() => {
      this.profileFrame = null;
      const model = this.model;
      const range: LogicalRange | null = this.chart.timeScale().getVisibleLogicalRange();
      if (!model || !range || !this.enabled.has('vp')) {
        this.profile.update(null, false);
        return;
      }
      this.profile.update(visibleProfile(model.candles, range.from, range.to), true, {
        up: this.theme.up,
        down: this.theme.down,
        poc: this.theme.text,
      });
    });
  };

  /* --------------------------------------------------------- crosshair */

  private handleCrosshair = (param: MouseEventParams<Time>): void => {
    const model = this.model;
    if (!model) return;
    if (!param.time || param.logical === undefined) {
      this.emitLast();
      return;
    }
    const index = Math.round(param.logical);
    this.emit(index, true);
  };

  private emitLast(): void {
    if (this.model) this.emit(this.model.candles.length - 1, false);
  }

  private emit(index: number, hovering: boolean): void {
    const model = this.model;
    const candle = model?.candles[index];
    if (!model || !candle) return;
    const prev = model.candles[index - 1];
    const base = prev ? prev.close : candle.open;
    // Indicator points omit only the leading warm-up bars, so a point's index
    // is the candle index shifted by the number of missing leading points.
    const at = (points: LinePoint[]): number | undefined =>
      points[index - (model.candles.length - points.length)]?.value;
    const values: CrosshairInfo['values'] = {};
    for (const id of OVERLAY_IDS)
      values[id] = hovering ? at(model.overlays[id]) : (lastValue(model.overlays[id]) ?? undefined);
    values.bb = hovering ? at(model.bands.middle) : (lastValue(model.bands.middle) ?? undefined);
    values.bbUpper = hovering ? at(model.bands.upper) : (lastValue(model.bands.upper) ?? undefined);
    values.bbLower = hovering ? at(model.bands.lower) : (lastValue(model.bands.lower) ?? undefined);
    values.rsi = hovering ? at(model.rsi) : (lastValue(model.rsi) ?? undefined);
    this.onCrosshair({
      candle,
      change: candle.close - base,
      changePercent: base ? (candle.close / base - 1) * 100 : 0,
      values,
      hovering,
    });
  }

  destroy(): void {
    if (this.profileFrame !== null) cancelAnimationFrame(this.profileFrame);
    this.chart.unsubscribeCrosshairMove(this.handleCrosshair);
    this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.scheduleProfile);
    this.candles.detachPrimitive(this.profile);
    this.chart.remove();
  }
}
