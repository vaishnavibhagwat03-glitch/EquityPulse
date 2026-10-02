'use client';

import Link from 'next/link';
import { memo } from 'react';
import type { Peer } from '@/lib/api';
import { formatMarketCap, formatNumber, formatPrice } from '@/lib/format';
import { useQuote } from '@/stores/stockStore';
import { ChangeText, Label } from '@/components/ui/primitives';

/** Same-industry peers with live prices: two lines per peer, no wrapping. */
export function PeersTable({ peers, industry }: { peers: readonly Peer[]; industry: string }) {
  if (!peers.length) return null;
  return (
    <section aria-labelledby="peers-title">
      <Label as="h2">
        <span id="peers-title">Peers · {industry}</span>
      </Label>
      <ul className="mt-2">
        {peers.map(p => (
          <PeerRow key={p.symbol} peer={p} />
        ))}
      </ul>
    </section>
  );
}

const PeerRow = memo(function PeerRow({ peer }: { peer: Peer }) {
  const q = useQuote(peer.symbol);
  return (
    <li className="border-b border-line-subtle">
      <Link href={`/${encodeURIComponent(peer.symbol)}`} className="group block py-2.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate num text-[12.5px] font-semibold text-ink group-hover:underline">
            {peer.symbol}
          </span>
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="num text-[12.5px] text-ink">
              {formatPrice(q?.price ?? peer.price)}
            </span>
            <ChangeText
              value={q?.changePercent ?? peer.changePercent}
              className="w-[58px] text-right text-[12px]"
            />
          </span>
        </span>
        <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] text-muted">
          <span className="truncate">{peer.name}</span>
          <span className="shrink-0 num">
            {formatMarketCap(peer.marketCap)} · P/E{' '}
            {peer.pe === null ? 'n/m' : formatNumber(peer.pe, 1)}
          </span>
        </span>
      </Link>
    </li>
  );
});
