import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { IconComponent } from '@/components/ui/icon';

export function Card({
  className,
  interactive = false,
  children,
  ...rest
}: {
  className?: string;
  interactive?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'sheen-top card-face relative rounded-2xl border border-line shadow-card',
        interactive &&
          'transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:border-brand-line hover:shadow-lift',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  icon: Icon,
  iconClassName,
  actions,
  className,
  as: Heading = 'h3',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconComponent;
  iconClassName?: string;
  actions?: ReactNode;
  className?: string;
  as?: 'h2' | 'h3' | 'h4';
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span
            className={cn(
              'glow-current grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-line bg-brand-soft text-brand',
              iconClassName,
            )}
          >
            <Icon size={17} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <Heading className="truncate text-sm font-bold text-ink">{title}</Heading>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
