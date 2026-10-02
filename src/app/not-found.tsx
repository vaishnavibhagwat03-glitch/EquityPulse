import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="label-caps">404 · Not found</p>
      <h1 className="mt-3 font-display text-[clamp(32px,4vw,48px)] leading-tight text-ink">
        No security by that name.
      </h1>
      <p className="mt-3 max-w-md text-[13px] leading-6 text-muted">
        Check the symbol, or search the full universe of 5,247 NSE and BSE securities with the
        command palette.
      </p>
      <div className="mt-6 flex gap-2">
        <Link
          href="/screener"
          className="inline-flex h-9 press items-center rounded-md bg-surface-inverse px-4 text-[12.5px] font-medium text-ink-inverse"
        >
          OPEN SCREENER
        </Link>
        <Link
          href="/"
          className="inline-flex h-9 press items-center rounded-md border border-line bg-surface px-4 text-[12.5px] font-medium text-ink"
        >
          MARKETS
        </Link>
      </div>
    </div>
  );
}
