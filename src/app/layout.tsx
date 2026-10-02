import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import type { ReactNode } from 'react';
import { GlobalOverlays } from '@/components/Layout/GlobalOverlays';
import { Providers } from '@/components/Layout/Providers';
import { StatusBar } from '@/components/Layout/StatusBar';
import { TopNav } from '@/components/Layout/TopNav';
import { INTRO_BOOT_SCRIPT } from '@/lib/boot';
import { SITE_URL } from '@/lib/site';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'EquityPulse — Market intelligence, without the noise',
    template: '%s · EquityPulse',
  },
  description:
    'Screen 5,000+ NSE & BSE securities using fundamental and technical signals. Real-time simulated market data, candlestick charts and a keyboard-first workspace.',
  applicationName: 'EquityPulse',
  keywords: [
    'stock screener',
    'NSE',
    'BSE',
    'NIFTY 50',
    'SENSEX',
    'technical analysis',
    'fundamental analysis',
  ],
  openGraph: {
    title: 'EquityPulse — Market intelligence, without the noise',
    description: 'Screen 5,000+ NSE & BSE securities using fundamental and technical signals.',
    type: 'website',
    siteName: 'EquityPulse',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0e0d' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en-IN"
      data-theme="light"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
    >
      <head>
        {/* Applies the stored theme before first paint (no flash of the wrong theme). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Decides before first paint whether the boot sequence covers the home page. */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md"
        >
          Skip to content
        </a>
        <Providers>
          <div id="app-root" className="flex min-h-dvh flex-col">
            <TopNav />
            <main
              id="main"
              className="flex flex-1 flex-col"
              style={{ paddingBottom: 'var(--status-height)' }}
            >
              {children}
            </main>
            <StatusBar />
          </div>
          <GlobalOverlays />
        </Providers>
      </body>
    </html>
  );
}
