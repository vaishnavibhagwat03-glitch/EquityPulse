'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/cn';
import { useModKey } from '@/hooks/useHotkeys';
import { useUiStore } from '@/stores/uiStore';
import { useWatchlistStore } from '@/stores/watchlistStore';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/primitives';
import { ConnectionStatus } from './ConnectionStatus';
import { MarketClock } from './MarketClock';
import { Wordmark } from './Wordmark';

const LINKS = [
  { href: '/', label: 'Markets', match: (p: string) => p === '/' },
  { href: '/screener', label: 'Screener', match: (p: string) => p.startsWith('/screener') },
  { href: '/watchlist', label: 'Watchlist', match: (p: string) => p.startsWith('/watchlist') },
] as const;

export function TopNav() {
  const pathname = usePathname() ?? '/';
  const setPalette = useUiStore(s => s.setPalette);
  const watchCount = useWatchlistStore(s => s.items.length);
  const modKey = useModKey();

  return (
    <header
      className="sticky top-0 z-30 border-b border-line bg-bg/92 backdrop-blur-md supports-[backdrop-filter]:bg-bg/80"
      style={{ height: 'var(--nav-height)' }}
    >
      <div className="flex h-full items-center gap-2 px-3 sm:gap-4 sm:px-4">
        <Link
          href="/"
          className="flex h-8 shrink-0 items-center rounded-md sm:mr-3 sm:px-1"
          aria-label="EquityPulse — Markets"
          style={{ viewTransitionName: 'wordmark' }}
        >
          {/* The boot sequence's wordmark lands here as it hands over. */}
          <span data-wordmark-target="" className="inline-flex">
            <Wordmark />
          </span>
        </Link>

        <nav aria-label="Primary" className="flex h-full items-stretch">
          {LINKS.map(link => {
            const active = link.match(pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center px-1.5 text-[12.5px] font-medium transition-colors duration-150 sm:px-3',
                  active ? 'text-ink' : 'text-muted hover:text-ink',
                  link.href === '/' && 'hidden sm:flex',
                )}
              >
                {link.label}
                {link.href === '/watchlist' && watchCount > 0 ? (
                  <span className="ml-1.5 rounded-sm bg-surface-active px-1 num text-[10px] text-ink-2">
                    {watchCount}
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-2 bottom-[-1px] left-2 h-[1.5px] bg-ink transition-[opacity,transform] duration-200 ease-out sm:right-3 sm:left-3',
                    active ? 'scale-x-100 opacity-100' : 'scale-x-50 opacity-0',
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setPalette(true)}
            className={cn(
              'hidden h-8 w-[min(34vw,300px)] press items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left md:flex',
              'text-[12.5px] text-muted transition-colors duration-150 hover:border-line-strong',
            )}
          >
            <Icon name="search" size={14} />
            <span className="flex-1 truncate">Search securities, actions…</span>
            <span className="flex items-center gap-0.5">
              <Kbd>{modKey}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <IconButton
            icon="search"
            label="Search"
            className="md:hidden"
            onClick={() => setPalette(true)}
          />
          <MarketClock className="hidden text-[12px] text-ink-2 lg:inline-flex lg:items-baseline" />
          <ConnectionStatus />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/** The applied theme is the `data-theme` attribute (set before paint by the head script). */
function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const appliedTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function ThemeToggle() {
  const theme = useUiStore(s => s.theme);
  const setTheme = useUiStore(s => s.setTheme);
  const resolved = useSyncExternalStore(subscribeToTheme, appliedTheme, () => 'light' as const);
  const next = resolved === 'dark' ? 'light' : 'dark';
  // Phones have no room for it in the bar; the command palette's "Theme"
  // actions (reached from the search button) cover it there.
  return (
    <IconButton
      className="max-sm:hidden"
      icon={resolved === 'dark' ? 'moon' : 'sun'}
      label={`Switch to ${next} theme${theme === 'system' ? ' (currently following system)' : ''}`}
      onClick={() => setTheme(next)}
    />
  );
}
