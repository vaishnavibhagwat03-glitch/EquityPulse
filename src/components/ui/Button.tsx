import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger';
type Size = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-surface-inverse text-ink-inverse border border-transparent hover:opacity-90 disabled:opacity-40',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-hover disabled:opacity-50',
  ghost:
    'bg-transparent text-ink-2 border border-transparent hover:bg-surface-active hover:text-ink disabled:opacity-40',
  subtle: 'bg-surface-active text-ink border border-transparent hover:bg-line disabled:opacity-40',
  danger:
    'bg-transparent text-negative border border-line hover:bg-negative-soft disabled:opacity-40',
};

const SIZES: Record<Size, string> = {
  xs: 'h-6 px-2 text-xs gap-1 rounded-sm',
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-sm gap-2 rounded-md',
  lg: 'h-10 px-4 text-[13.5px] gap-2 rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    icon,
    iconRight,
    loading,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconSize = size === 'lg' ? 16 : 14;
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 press items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon ? (
        <Icon
          name={loading ? 'refresh' : icon}
          size={iconSize}
          className={loading ? 'animate-spin' : undefined}
        />
      ) : null}
      {children}
      {iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: 'xs' | 'sm' | 'md';
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'sm', active, className, type = 'button', ...rest },
  ref,
) {
  const dims = size === 'xs' ? 'h-6 w-6' : size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex tap-target shrink-0 press items-center justify-center rounded-md text-muted',
        'transition-[background-color,color,transform] duration-150 ease-out',
        'hover:bg-surface-active hover:text-ink',
        active && 'bg-surface-active text-ink',
        dims,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'md' ? 16 : 14} />
    </button>
  );
});
