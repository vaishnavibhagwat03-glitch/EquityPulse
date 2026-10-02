import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { VolumeProfile } from '@/lib/technicalIndicators';

/**
 * Volume profile drawn as a horizontal histogram along the right edge of the
 * price pane: volume traded at each price over the visible range. Bars split
 * into up-close and down-close volume; the point of control (heaviest bin) and
 * the 70% value area are drawn a step stronger than the rest.
 */

type Target = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface ProfileColors {
  up: string;
  down: string;
  poc: string;
}

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private profile: VolumeProfile | null = null;
  private visible = false;
  private colors: ProfileColors = { up: 'rgba(0,0,0,.2)', down: 'rgba(0,0,0,.2)', poc: '#000' };

  private readonly view: IPrimitivePaneView = {
    zOrder: () => 'bottom',
    renderer: () => (this.visible && this.profile?.bins.length ? this.renderer : null),
  };

  private readonly renderer: IPrimitivePaneRenderer = {
    draw: (target: Target) => this.draw(target),
  };

  attached(param: SeriesAttachedParameter<Time>): void {
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  update(profile: VolumeProfile | null, visible: boolean, colors?: ProfileColors): void {
    this.profile = profile;
    this.visible = visible;
    if (colors) this.colors = colors;
    this.requestUpdate?.();
  }

  private draw(target: Target): void {
    const profile = this.profile;
    const series = this.series;
    if (!profile || !series || !profile.bins.length) return;
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const vr = scope.verticalPixelRatio;
      const hr = scope.horizontalPixelRatio;
      const maxWidth = scope.bitmapSize.width * 0.22;
      const right = scope.bitmapSize.width - 2 * hr;
      const peak = Math.max(1, ...profile.bins.map(b => b.volume));
      const va = profile.valueArea;

      profile.bins.forEach((bin, i) => {
        const yTop = series.priceToCoordinate(bin.high);
        const yBottom = series.priceToCoordinate(bin.low);
        if (yTop === null || yBottom === null) return;
        const top = Math.round(Math.min(yTop, yBottom) * vr) + Math.round(vr);
        const height = Math.max(1, Math.round(Math.abs(yBottom - yTop) * vr) - Math.round(2 * vr));
        const width = (bin.volume / peak) * maxWidth;
        const upWidth = bin.volume ? (bin.upVolume / bin.volume) * width : 0;
        const inValueArea = va ? i >= va.lowIndex && i <= va.highIndex : false;
        const isPoc = i === profile.poc;
        ctx.globalAlpha = isPoc ? 0.9 : inValueArea ? 0.55 : 0.32;
        ctx.fillStyle = this.colors.up;
        ctx.fillRect(right - width, top, upWidth, height);
        ctx.fillStyle = this.colors.down;
        ctx.fillRect(right - width + upWidth, top, width - upWidth, height);
        if (isPoc) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = this.colors.poc;
          ctx.fillRect(
            right - width - 3 * hr,
            top + Math.floor(height / 2),
            2 * hr,
            Math.max(1, Math.round(vr)),
          );
        }
      });
      ctx.globalAlpha = 1;
    });
  }
}
