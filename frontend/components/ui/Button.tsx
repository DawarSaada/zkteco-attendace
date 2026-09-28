'use client';
import Link from 'next/link';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { IconComponent } from '@/components/ui/icon';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'subtle'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'dangerGhost'
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'iconSm';

const VARIANTS: Record<ButtonVariant, string> = {
  // The gradient is the product's signature surface: aurora fill plus a
  // coloured halo rather than a grey drop shadow.
  primary: 'sheen-top aurora-bg glow-brand text-white hover:brightness-[1.12]',
  secondary:
    'sheen-top card-face text-ink border border-line shadow-card hover:border-line-strong hover:shadow-lift',
  subtle:
    'bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-strong',
  outline:
    'bg-transparent text-ink border border-line hover:bg-surface-2 hover:border-line-strong',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink',
  danger:
    'sheen-top bg-rose-600 text-white shadow-[0_10px_26px_-12px_rgb(225_29_72/0.75)] hover:bg-rose-500',
  dangerGhost:
    'bg-transparent text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/40',
  success:
    'sheen-top bg-emerald-600 text-white shadow-[0_10px_26px_-12px_rgb(5_150_105/0.75)] hover:bg-emerald-500',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-2.5 text-xs',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-5 text-sm',
  icon: 'h-10 w-10 rounded-xl',
  iconSm: 'h-8 w-8 rounded-lg',
};

const BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center font-semibold whitespace-nowrap transition-[transform,filter,background-color,border-color,color,box-shadow] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 motion-reduce:active:scale-100';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables interaction and keeps the label for width stability. */
  loading?: boolean;
  /** Replaces the label while `loading` is set. */
  loadingLabel?: ReactNode;
  icon?: IconComponent;
  /** Icon rendered after the label. */
  trailingIcon?: IconComponent;
  className?: string;
  children?: ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children' | 'className' | 'href'> & {
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    icon: Icon,
    trailingIcon: TrailingIcon,
    className,
    children,
    ...rest
  },
  ref,
) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], className);
  const label = loading && loadingLabel ? loadingLabel : children;

  const body = (
    <>
      {loading ? (
        <Loader2
          size={size === 'sm' ? 13 : 15}
          className="animate-spin"
          aria-hidden="true"
        />
      ) : (
        Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      )}
      {label != null && label !== '' && <span>{label}</span>}
      {TrailingIcon && !loading && (
        <TrailingIcon
          size={size === 'sm' ? 13 : 15}
          aria-hidden="true"
          className="transition-transform duration-200 group-hover/btn:translate-x-0.5 rtl:group-hover/btn:-translate-x-0.5"
        />
      )}
    </>
  );

  if (typeof rest.href === 'string') {
    const { href, ...anchorRest } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & {
      href: string;
    };
    return (
      <Link href={href} className={classes} {...anchorRest}>
        {body}
      </Link>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <button
      ref={ref}
      type={buttonRest.type ?? 'button'}
      aria-busy={loading || undefined}
      className={classes}
      {...buttonRest}
      disabled={buttonRest.disabled || loading}
    >
      {body}
    </button>
  );
});
