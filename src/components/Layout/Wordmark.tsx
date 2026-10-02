import { cn } from '@/lib/cn';

/**
 * The EquityPulse wordmark: wide-tracked capitals, the second word a step
 * quieter. Typography is the logo — no glyph to animate or decorate.
 */
export function Wordmark({
  className,
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'lg' | 'xl';
}) {
  const sizes = {
    sm: 'text-[11.5px] tracking-[0.14em] sm:text-[12.5px] sm:tracking-[0.2em]',
    lg: 'text-[18px] tracking-[0.28em]',
    xl: 'text-[clamp(26px,4.2vw,44px)] tracking-[0.32em]',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-baseline font-semibold whitespace-nowrap select-none',
        sizes[size],
        className,
      )}
    >
      <span className="text-ink">EQUITY</span>
      <span className="text-muted">PULSE</span>
    </span>
  );
}
