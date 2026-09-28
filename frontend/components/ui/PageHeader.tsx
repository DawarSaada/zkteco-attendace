import { cn } from '@/lib/utils/cn';
import type { ReactNode } from 'react';

/** Consistent page title block used at the top of every dashboard route. */
export function PageHeader({
  eyebrow,
  title,
  description,
  badge,
  actions,
  className,
}: {
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative pb-6', className)}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1.5 text-[10px] font-bold tracking-[0.16em] text-ink-subtle uppercase">
              {eyebrow}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[1.75rem] leading-none font-bold tracking-[-0.03em] text-ink">
              {title}
            </h1>
            {badge}
          </div>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {actions}
          </div>
        )}
      </div>

      {/* Gradient hairline instead of a flat rule. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-brand-line via-line to-transparent"
      />
    </div>
  );
}
