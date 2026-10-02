import type { Metadata } from 'next';
import { ScreenerWorkspace } from '@/components/Screener/ScreenerWorkspace';

export const metadata: Metadata = {
  title: 'Screener',
  description:
    'Screen 5,000+ NSE & BSE securities on 53 fundamental, market and technical criteria with nested AND / OR logic.',
};

export default function ScreenerPage() {
  return <ScreenerWorkspace />;
}
