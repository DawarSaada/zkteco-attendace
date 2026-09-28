import { Card } from '@/components/ui/Card';
import { CountUp } from '@/components/ui/CountUp';
import { Sparkline } from '@/components/ui/Charts';
import { cn } from '@/lib/utils/cn';
import type { ChartTone } from '@/components/ui/Charts';
import type { IconComponent } from '@/components/ui/icon';
import type { ReactNode } from 'react';

export const TONE_TILE: Record<ChartTone, string> = {
  aurora: 'border-brand-line bg-brand-soft text-brand',
  brand: 'border-brand-line bg-brand-soft text-brand',
  success: 'border-success-line bg-success-soft text-success',
  danger: 'border-danger-line bg-danger-soft text-danger',
  warning: 'border-warning-line bg-warning-soft text-warning',
  info: 'border-info-line bg-info-soft text-info',
};

/** Large hero metric used across the overview. */
export function StatCard({
  label,
  value,
  suffix,
  decimals = 0,
  valueNode,
  icon: Icon,
  tone = 'aurora',
  footer,
  sparkline,
  className,
}: {
  label: string;
  value?: number;
  suffix?: string;
  decimals?: number;
  /** Replaces the animated number entirely (e.g. for timestamps). */
  valueNode?: ReactNode;
  icon: IconComponent;
  tone?: ChartTone;
  footer?: ReactNode;
  sparkline?: number[];
  className?: string;
}) {
  return (
    <Card
      interactive
      className={cn('sheen-top flex flex-col justify-between p-5', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold tracking-[0.12em] text-ink-subtle uppercase">
          {label}
        </p>
        <span
          className={cn(
            'glow-current grid h-10 w-10 shrink-0 place-items-center rounded-xl border',
            TONE_TILE[tone],
          )}
        >
          <Icon size={18} aria-hidden="true" />
        </span>
      </div>

      <div className="mt-4">
        {valueNode ?? (
          <p className="text-[1.75rem] leading-none font-extrabold tracking-tight text-ink">
            <CountUp value={value ?? 0} decimals={decimals} suffix={suffix} />
          </p>
        )}

        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} tone={tone} height={38} className="mt-3" />
        )}

        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </Card>
  );
}

/** Compact metric for insight strips above tables. */
export function MetricTile({
  label,
  value,
  suffix,
  decimals = 0,
  icon: Icon,
  tone = 'brand',
  sparkline,
  className,
}: {
  label: string;
  value?: number;
  suffix?: string;
  decimals?: number;
  icon?: IconComponent;
  tone?: ChartTone;
  sparkline?: number[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'sheen-top flex items-center gap-3.5 rounded-xl border border-line bg-surface-2/50 px-3.5 py-3',
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-lg border',
            TONE_TILE[tone],
          )}
        >
          <Icon size={16} aria-hidden="true" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[10px] font-bold tracking-[0.1em] text-ink-subtle uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-lg leading-none font-bold tracking-tight text-ink">
          <CountUp value={value ?? 0} decimals={decimals} suffix={suffix} />
        </p>
      </div>

      {sparkline && sparkline.length > 1 && (
        <Sparkline
          data={sparkline}
          tone={tone}
          height={30}
          showEndPoint={false}
          className="w-16 shrink-0"
        />
      )}
    </div>
  );
}
