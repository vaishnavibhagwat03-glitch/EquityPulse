import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StockDetail } from '@/components/StockDetail/StockDetail';
import { formatPercent, formatPrice } from '@/lib/format';
import { findStock, getFundamentals, getPeers } from '@/lib/server/marketData';

/**
 * Stock detail. Rendered on the server for fast first paint and crawlable
 * metadata (name, price, key ratios); the live price, chart and interactive
 * tabs hydrate on the client.
 */

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const stock = findStock(symbol);
  if (!stock) return { title: 'Security not found' };
  const title = `${stock.symbol} · ${stock.name}`;
  const description = `${stock.name} (${stock.exchange}: ${stock.symbol}) — ₹${formatPrice(stock.price)} (${formatPercent(stock.changePercent, { signed: true })}). Candlestick chart, technical indicators, fundamentals and peers. Simulated market data.`;
  return {
    title,
    description,
    openGraph: { title: `${title} — EquityPulse`, description },
    alternates: { canonical: `/${encodeURIComponent(stock.symbol)}` },
  };
}

export default async function StockPage({ params }: Props) {
  const { symbol } = await params;
  const stock = findStock(symbol);
  if (!stock) notFound();
  const peers = getPeers(stock).map(p => ({
    symbol: p.symbol,
    name: p.name,
    price: p.price,
    changePercent: p.changePercent,
    marketCap: p.marketCap,
    pe: p.pe,
    roe: p.roe,
  }));
  return <StockDetail initial={stock} peers={peers} fundamentals={getFundamentals(stock)} />;
}
