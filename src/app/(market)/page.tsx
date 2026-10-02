import { bootInputFromOverview } from '@/components/Boot/bootInput';
import { MarketHome } from '@/components/MarketOverview/MarketHome';
import { getOverview } from '@/lib/server/marketData';

/**
 * Markets (home). Server-rendered from the session snapshot, so the first
 * paint is the complete market grid with real figures; the client then takes
 * it live. The snapshot only changes when the trading day rolls, so the HTML
 * is cached and regenerated in the background.
 */
export const revalidate = 300;

export default function MarketsPage() {
  const overview = getOverview();
  return <MarketHome snapshot={overview} boot={bootInputFromOverview(overview)} />;
}
