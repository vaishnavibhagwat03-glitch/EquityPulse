import { cn } from '@/lib/cn';

/**
 * "Market intelligence. Without the noise." Shared by the home masthead and
 * the boot sequence, which hands its copy over to the masthead's — so both
 * must set identically.
 */
export function Headline({
  as: Tag = 'h1',
  className,
  ...rest
}: { as?: 'h1' | 'p'; className?: string } & React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <Tag
      className={cn(
        'font-display text-[clamp(38px,5vw,62px)] leading-[1.02] font-normal tracking-[-0.012em] text-ink',
        className,
      )}
      {...rest}
    >
      Market intelligence.
      <br />
      <em className="text-muted">Without the noise.</em>
    </Tag>
  );
}
