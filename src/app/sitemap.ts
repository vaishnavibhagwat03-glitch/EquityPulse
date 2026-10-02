import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** The app's pages plus the headline index constituents' detail pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['', '/screener', '/watchlist', '/heatmap'].map(path => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: 'daily' as const,
  }));
  const stocks = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK'].map(symbol => ({
    url: `${SITE_URL}/${symbol}`,
    changeFrequency: 'daily' as const,
  }));
  return [...pages, ...stocks];
}
