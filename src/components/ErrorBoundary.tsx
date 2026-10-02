'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * Isolates a failure to one region. The rest of the application keeps working;
 * the region shows a calm, product-level message and a retry — never a raw
 * stack trace. `resetKeys` resets the boundary automatically when its inputs
 * change (e.g. navigating to another symbol).
 */

export interface FallbackProps {
  error: Error;
  reset: () => void;
}

interface Props {
  children: ReactNode;
  /** Name of the region, used in the default fallback and logs. */
  region: string;
  title?: string;
  description?: string;
  fallback?: (props: FallbackProps) => ReactNode;
  resetKeys?: readonly unknown[];
  onReset?: () => void;
  className?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Production builds would report this; never surface it to the user.
    console.error(`[${this.props.region}] render failure`, error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (!this.state.error) return;
    const a = prev.resetKeys ?? [];
    const b = this.props.resetKeys ?? [];
    if (a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]))) this.reset();
  }

  reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return (
      <RegionFallback
        title={this.props.title ?? `${this.props.region} temporarily unavailable.`}
        description={this.props.description ?? 'The rest of EquityPulse is unaffected.'}
        onRetry={this.reset}
        className={this.props.className}
      />
    );
  }
}

export function RegionFallback({
  title,
  description,
  onRetry,
  className,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex h-full min-h-[160px] flex-col items-center justify-center gap-3 p-6 text-center',
        className,
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted">
        <Icon name="alert" size={14} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          RETRY
        </Button>
      ) : null}
    </div>
  );
}
