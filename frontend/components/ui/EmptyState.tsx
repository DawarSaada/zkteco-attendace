import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { IconComponent } from '@/components/ui/icon';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  tone = 'neutral',
}: {
  icon?: IconComponent;
  title: ReactNode;
  description?: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  secondaryAction?: ReactNode;
  className?: string;
  tone?: 'neutral' | 'dashed';
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3.5 px-6 py-12 text-center',
        tone === 'dashed' &&
          'rounded-2xl border border-dashed border-line-strong bg-surface/60 backdrop-blur-sm',
        className,
      )}
    >
      {Icon && (
        <span className="aurora-ring glow-current relative grid h-14 w-14 place-items-center rounded-2xl border border-brand-line bg-brand-soft text-brand">
          <Icon size={23} aria-hidden="true" />
        </span>
      )}

      <div className="space-y-1">
        <p className="text-sm font-bold text-ink">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action?.href && (
            <Link
              href={action.href}
              className="sheen-top aurora-bg glow-brand inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white transition-all hover:brightness-110"
            >
              {action.label}
              <ArrowRight size={13} aria-hidden="true" className="rtl:rotate-180" />
            </Link>
          )}
          {action?.onClick && (
            <button
              type="button"
              onClick={action.onClick}
              className="sheen-top aurora-bg glow-brand inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white transition-all hover:brightness-110"
            >
              {action.label}
              <ArrowRight size={13} aria-hidden="true" className="rtl:rotate-180" />
            </button>
          )}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
