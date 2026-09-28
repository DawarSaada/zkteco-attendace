import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/** Rounded surface that wraps a data table. */
export function TableCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'sheen-top relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TableScroll({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('overflow-x-auto', className)}>{children}</div>;
}

export function Table({
  caption,
  className,
  children,
}: {
  /** Visually hidden, announced by screen readers. */
  caption?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <table className={cn('w-full text-start', className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  );
}

export function THead({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <thead
      className={cn(
        'border-b border-line bg-surface-2/50 backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </thead>
  );
}

type Align = 'start' | 'center' | 'end';

const ALIGN: Record<Align, string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};

export function Th({
  align = 'start',
  numeric = false,
  className,
  children,
  ...rest
}: {
  align?: Align;
  numeric?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'align'>) {
  return (
    <th
      scope="col"
      data-numeric={numeric || undefined}
      className={cn(
        'px-5 py-3.5 text-[10px] font-bold tracking-[0.1em] text-ink-subtle uppercase',
        ALIGN[align],
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Tr({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'group transition-colors duration-150 hover:bg-surface-2/70',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({
  align = 'start',
  numeric = false,
  className,
  children,
  ...rest
}: {
  align?: Align;
  numeric?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<React.TdHTMLAttributes<HTMLTableCellElement>, 'align'>) {
  return (
    <td
      data-numeric={numeric || undefined}
      className={cn('px-5 py-4 align-middle', ALIGN[align], className)}
      {...rest}
    >
      {children}
    </td>
  );
}

export function TBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <tbody className={cn('divide-y divide-line text-sm text-ink', className)}>
      {children}
    </tbody>
  );
}

/** Full-width row used for empty / loading states inside a table body. */
export function TableMessageRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr className="hover:bg-transparent">
      <td colSpan={colSpan} className="px-6 py-14 text-center">
        {children}
      </td>
    </tr>
  );
}
