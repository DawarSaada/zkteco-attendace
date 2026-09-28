'use client';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { cn } from '@/lib/utils/cn';

interface SortHeaderProps {
  columnKey: string;
  label: string;
  activeKey?: string;
  sortOrder?: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

const ALIGN = {
  left: 'justify-start text-start',
  center: 'justify-center text-center',
  right: 'justify-end text-end',
} as const;

export function SortHeader({
  columnKey,
  label,
  activeKey,
  sortOrder = 'asc',
  onSort,
  align = 'left',
  className = '',
}: SortHeaderProps) {
  const { t } = useLanguage();
  const isActive = activeKey === columnKey;

  const tooltip = isActive
    ? sortOrder === 'asc'
      ? t('sort_desc')
      : t('sort_asc')
    : t('sort_neutral');

  return (
    <th
      scope="col"
      aria-sort={
        isActive ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className={cn(
        'px-5 py-3.5 text-[10px] font-bold tracking-[0.1em] text-ink-subtle uppercase select-none',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        title={tooltip}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-1.5 transition-colors hover:text-ink',
          ALIGN[align],
        )}
      >
        <span className={cn('truncate', isActive && 'text-brand')}>{label}</span>
        <span className="shrink-0 rounded transition-colors group-hover:bg-surface-3">
          {isActive ? (
            sortOrder === 'asc' ? (
              <ArrowUp size={12} className="text-brand" aria-hidden="true" />
            ) : (
              <ArrowDown size={12} className="text-brand" aria-hidden="true" />
            )
          ) : (
            <ArrowUpDown
              size={11}
              className="text-ink-subtle/70 group-hover:text-ink-muted"
              aria-hidden="true"
            />
          )}
        </span>
      </button>
    </th>
  );
}
