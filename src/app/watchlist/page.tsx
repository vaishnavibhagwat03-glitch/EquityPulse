import type { Metadata } from 'next';
import { WatchlistWorkspace } from '@/components/Watchlist/WatchlistWorkspace';

export const metadata: Metadata = {
  title: 'Watchlist',
  description: 'Monitor your securities with live simulated prices, ranges and valuation.',
};

export default function WatchlistPage() {
  return <WatchlistWorkspace />;
}
