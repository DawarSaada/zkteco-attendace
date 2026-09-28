import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { IconComponent } from '@/components/ui/icon';

export type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'accent';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2/80 text-ink-muted border-line',
  brand: 'bg-brand-soft text-brand border-brand-line',
  success: 'bg-success-soft text-success border-success-line',
  danger: 'bg-danger-soft text-danger border-danger-line',
  warning: 'bg-warning-soft text-warning border-warning-line',
  info: 'bg-info-soft text-info border-info-line',
  accent: 'bg-accent-soft text-accent border-accent-line',
};

const DOTS: Record<BadgeTone, string> = {
  neutral: 'bg-ink-subtle',
  brand: 'bg-brand',
  success: 'bg-emerald-500',
  danger: 'bg-rose-500',
  warning: 'bg-amber-500',
  info: 'bg-indigo-500',
  accent: 'bg-violet-500',
};

export function Badge({
  tone = 'neutral',
  size = 'md',
  dot = false,
  pulse = false,
  icon: Icon,
  iconClassName,
  className,
  children,
  title,
}: {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  /** Renders a status dot before the label. */
  dot?: boolean;
  /** Animates the dot — use for live/streaming states. */
  pulse?: boolean;
  icon?: IconComponent;
  iconClassName?: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold shadow-[inset_0_1px_0_0_var(--surface-sheen)] backdrop-blur-sm',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {pulse && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                DOTS[tone],
              )}
            />
          )}
          <span
            className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', DOTS[tone])}
          />
        </span>
      )}
      {Icon && (
        <Icon
          size={size === 'sm' ? 11 : 12}
          className={cn('shrink-0', iconClassName)}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
