import type { Metadata } from 'next';
import { HeatmapWorkspace } from '@/components/Heatmap/HeatmapWorkspace';

export const metadata: Metadata = {
  title: 'Heatmap',
  description: 'Sector heatmap of the largest NSE & BSE companies, coloured by live day change.',
};

export default function HeatmapPage() {
  return <HeatmapWorkspace />;
}
