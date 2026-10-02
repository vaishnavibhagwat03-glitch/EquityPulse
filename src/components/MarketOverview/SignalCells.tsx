'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { MarketBreadth, MarketMovers, Mover, SectorSummary } from '@/types/market';
import { cn } from '@/lib/cn';
import {
  formatCompact,
  formatCrore,
  formatInteger,
  formatPercent,
  formatPrice,
  formatSigned,
} from '@/lib/format';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ChangeText } from '@/components/ui/primitives';
import { emergeStyle } from './emerge';

const formatCount = (v: number): string => formatInteger(Math.round(v));
const formatNet = (v: number): string => formatSigned(Math.round(v), 0);

export function CellHead({ id, title, meta }: { id?: string; title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 id={id} className="label-caps text-ink-2">
        {title}
      </h3>
      {meta ? <span className="truncate num text-[10.5px] text-faint">{meta}</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- breadth */

function BigStat({
  value,
  label,
  tone,
  signed = false,
}: {
  value: number;
  label: string;
  tone?: 'up' | 'down';
  signed?: boolean;
}) {
  return (
    <div className="min-w-0">
      <AnimatedNumber
        value={value}
        format={signed ? formatNet : formatCount}
        className={cn(
          'block text-[clamp(20px,2vw,26px)] leading-none font-medium tracking-[-0.02em]',
          tone === 'up' ? 'up' : tone === 'down' ? 'down' : 'text-ink',
        )}
      />
      <span className="mt-1.5 block label-caps">{label}</span>
    </div>
  );
}

/** Advancing · unchanged · declining as one bar, separated by surface gaps. */
function BreadthBar({ breadth }: { breadth: MarketBreadth }) {
  const total = breadth.advancing + breadth.unchanged + breadth.declining || 1;
  const parts = [
    { key: 'adv', share: breadth.advancing / total, className: 'bg-positive' },
    { key: 'unch', share: breadth.unchanged / total, className: 'bg-line-strong' },
    { key: 'dec', share: breadth.declining / total, className: 'bg-negative' },
  ].filter(p => p.share > 0);
  return (
    <div
      className="flex h-1.5 gap-[2px]"
      role="img"
      aria-label={`${formatPercent((breadth.advancing / total) * 100, { decimals: 0 })} of securities advancing`}
    >
      {parts.map(p => (
        <span
          key={p.key}
          className={cn(
            'h-full rounded-[2px] transition-[flex-grow] duration-500 ease-out',
            p.className,
          )}
          style={{ flexGrow: p.share, flexBasis: 0 }}
        />
      ))}
    </div>
  );
}

function bucketLabel(i: number, buckets: number): string {
  const from = -5 + i * 0.5;
  if (i === 0) return `${formatPercent(from + 0.5, { decimals: 1, signed: true })} or worse`;
  if (i === buckets - 1) return `${formatPercent(from, { decimals: 1, signed: true })} or better`;
  return `${formatPercent(from, { decimals: 1, signed: true })} to ${formatPercent(from + 0.5, { decimals: 1, signed: true })}`;
}

/**
 * How the day's moves are spread: securities per half-percent bucket, tails
 * clamped at ±4.5%. Hovering a bucket writes its range and count into the
 * caption line rather than a floating tooltip, so nothing covers the bars.
 */
function Distribution({ counts }: { counts: readonly number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...counts);
  const mid = counts.length / 2;
  return (
    <figure className="flex min-h-[112px] min-w-0 flex-1 flex-col">
      <figcaption className="flex h-4 items-baseline justify-between num text-[10.5px] text-muted">
        {hover === null ? (
          <span>Day change distribution</span>
        ) : (
          <span className="text-ink-2">
            {bucketLabel(hover, counts.length)} ·{' '}
            <span className="text-ink">{formatInteger(counts[hover])}</span> securities
          </span>
        )}
      </figcaption>
      <div
        className="relative mt-2 flex min-h-16 flex-1 items-end gap-[2px]"
        onMouseLeave={() => setHover(null)}
      >
        {counts.map((c, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-label={`${bucketLabel(i, counts.length)}: ${formatInteger(c)} securities`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            className="group relative flex h-full flex-1 cursor-default items-end"
          >
            <span
              className={cn(
                'w-full rounded-t-[2px] transition-[height,opacity] duration-500 ease-out',
                i < mid ? 'bg-negative' : 'bg-positive',
                hover === null || hover === i ? 'opacity-80' : 'opacity-35',
              )}
              style={{ height: `${Math.max(2, (c / max) * 100)}%` }}
            />
          </button>
        ))}
        <span
          aria-hidden
          className="absolute -bottom-1 left-1/2 h-[calc(100%+4px)] w-px -translate-x-1/2 bg-line-strong"
        />
      </div>
      <div className="mt-1.5 flex justify-between num text-[10px] text-faint" aria-hidden>
        <span>−5%</span>
        <span>0</span>
        <span>+5%</span>
      </div>
    </figure>
  );
}

export function BreadthCell({
  breadth,
  distribution,
  emerge,
}: {
  breadth: MarketBreadth;
  distribution: readonly number[];
  emerge: number;
}) {
  const stats = [
    { label: 'Volume', value: `${formatCompact(breadth.volume)} sh` },
    { label: 'Turnover', value: formatCrore(breadth.turnover) },
    { label: '52W highs', value: formatInteger(breadth.newHighs) },
    { label: '52W lows', value: formatInteger(breadth.newLows) },
  ];
  return (
    <section
      data-emerge
      style={emergeStyle(emerge)}
      aria-labelledby="breadth-title"
      className="col-span-12 flex flex-col gap-4 bg-surface p-4 lg:col-span-4"
    >
      <CellHead
        id="breadth-title"
        title="Market breadth"
        meta={`${formatInteger(breadth.total)} securities`}
      />
      <div className="grid grid-cols-3 gap-3">
        <BigStat value={breadth.advancing} label="Advancing" tone="up" />
        <BigStat value={breadth.declining} label="Declining" tone="down" />
        <BigStat value={breadth.advancing - breadth.declining} label="Net" signed />
      </div>
      <BreadthBar breadth={breadth} />
      <Distribution counts={distribution} />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-line-subtle pt-3 text-[12px]">
        {stats.map(s => (
          <div key={s.label} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">{s.label}</dt>
            <dd className="num text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------------------------------------------------------------- sectors */

const COLLAPSED_EACH = 6;

/**
 * Cap-weighted sector moves as a diverging bar list around zero. Collapsed it
 * shows the six strongest and six weakest; the rest are one click away.
 * Each row opens the screener on that sector.
 */
export function SectorMovement({
  sectors,
  onOpenSector,
  emerge,
}: {
  sectors: readonly SectorSummary[];
  onOpenSector: (name: string) => void;
  emerge: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxAbs = Math.max(0.5, ...sectors.map(s => Math.abs(s.changePercent)));
  const collapsible = sectors.length > COLLAPSED_EACH * 2 + 1;
  const hidden = collapsible && !expanded ? sectors.length - COLLAPSED_EACH * 2 : 0;
  const rows: (SectorSummary | 'gap')[] = hidden
    ? [...sectors.slice(0, COLLAPSED_EACH), 'gap', ...sectors.slice(-COLLAPSED_EACH)]
    : [...sectors];

  return (
    <section
      data-emerge
      style={emergeStyle(emerge)}
      aria-labelledby="sectors-title"
      className="col-span-12 flex flex-col gap-3 bg-surface p-4 md:col-span-6 lg:col-span-4"
    >
      <CellHead id="sectors-title" title="Sector movement" meta="cap-weighted · day %" />
      <ul className="-mx-2">
        {rows.map(row =>
          row === 'gap' ? (
            <li
              key="gap"
              aria-hidden
              className="flex h-5 items-center gap-2 px-2 num text-[10px] text-faint"
            >
              <span className="h-px flex-1 bg-line-subtle" />
              {hidden} more
              <span className="h-px flex-1 bg-line-subtle" />
            </li>
          ) : (
            <li key={row.name}>
              <button
                type="button"
                onClick={() => onOpenSector(row.name)}
                title={`Screen ${row.name}: ${formatInteger(row.advancing)} advancing, ${formatInteger(row.declining)} declining`}
                className="grid h-[26px] w-full grid-cols-[minmax(0,1fr)_minmax(56px,30%)_52px] items-center gap-3 rounded-sm px-2 text-left transition-colors duration-150 hover:bg-surface-hover"
              >
                <span className="truncate text-[12.5px] text-ink-2">{row.name}</span>
                <span className="relative h-2" aria-hidden>
                  <span className="absolute top-[-3px] bottom-[-3px] left-1/2 w-px bg-line" />
                  <span
                    className={cn(
                      'absolute top-0 h-full transition-[width] duration-500 ease-out',
                      row.changePercent >= 0
                        ? 'left-1/2 rounded-r-[2px] bg-positive/80'
                        : 'right-1/2 rounded-l-[2px] bg-negative/80',
                    )}
                    style={{ width: `${(Math.abs(row.changePercent) / maxAbs) * 50}%` }}
                  />
                </span>
                <ChangeText value={row.changePercent} className="text-right text-[12px]" />
              </button>
            </li>
          ),
        )}
      </ul>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          className="mt-auto self-start text-[11.5px] text-muted transition-colors duration-150 hover:text-ink"
        >
          {expanded ? 'Show fewer' : `Show all ${sectors.length} sectors`}
        </button>
      ) : null}
    </section>
  );
}

/* ----------------------------------------------------------------- movers */

function MoverList({ title, items }: { title: string; items: readonly Mover[] }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1 label-caps">{title}</h4>
      <ol>
        {items.map(m => (
          <li key={m.symbol}>
            <Link
              href={`/${encodeURIComponent(m.symbol)}`}
              title={`${m.name} · ₹${formatPrice(m.price)}`}
              className="-mx-1.5 flex flex-col rounded-sm px-1.5 py-1 transition-colors duration-150 hover:bg-surface-hover"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate num text-[12px] font-semibold text-ink">{m.symbol}</span>
                <ChangeText value={m.changePercent} className="text-[12px]" />
              </span>
              <span className="truncate text-[10.5px] text-faint">{m.name}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TopMovers({ movers, emerge }: { movers: MarketMovers; emerge: number }) {
  const maxTurnover = Math.max(1, ...movers.active.map(m => m.turnover));
  return (
    <section
      data-emerge
      style={emergeStyle(emerge)}
      aria-labelledby="movers-title"
      className="col-span-12 flex flex-col gap-3 bg-surface p-4 md:col-span-6 lg:col-span-4"
    >
      {/* Movers are ranked within NIFTY 500 so illiquid micro-caps do not crowd the list. */}
      <CellHead id="movers-title" title="Top movers" meta="NIFTY 500 · day change" />
      <div className="grid grid-cols-2 gap-x-5">
        <MoverList title="Gainers" items={movers.gainers} />
        <MoverList title="Losers" items={movers.losers} />
      </div>
      <div className="border-t border-line-subtle pt-3">
        <h4 className="mb-1 label-caps">Most active · turnover</h4>
        <ol>
          {movers.active.map(m => (
            <li key={m.symbol}>
              <Link
                href={`/${encodeURIComponent(m.symbol)}`}
                title={m.name}
                className="-mx-1.5 grid h-[26px] grid-cols-[76px_minmax(0,1fr)_auto_52px] items-center gap-2.5 rounded-sm px-1.5 transition-colors duration-150 hover:bg-surface-hover"
              >
                <span className="truncate num text-[12px] font-semibold text-ink">{m.symbol}</span>
                <span className="relative h-1.5" aria-hidden>
                  <span
                    className="absolute inset-y-0 left-0 rounded-[2px] bg-line-strong transition-[width] duration-500 ease-out"
                    style={{ width: `${(m.turnover / maxTurnover) * 100}%` }}
                  />
                </span>
                <span className="text-right num text-[11.5px] whitespace-nowrap text-ink-2">
                  {formatCrore(m.turnover)}
                </span>
                <ChangeText value={m.changePercent} className="text-right text-[11.5px]" />
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
