'use client';
import { cn } from '@/lib/utils/cn';
import type { IconComponent } from '@/components/ui/icon';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconComponent;
  title?: string;
}

const SIZES = {
  sm: 'h-7 px-2.5 text-[11px]',
  md: 'h-8 px-3 text-xs',
} as const;

/**
 * Pill switcher for mutually exclusive options. Each option is a real button
 * with `aria-pressed`, so it is operable and announced correctly.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-line bg-surface-2/70 p-1 backdrop-blur',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title ?? option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-all duration-200',
              SIZES[size],
              active
                ? 'sheen-top aurora-bg glow-brand text-white'
                : 'text-ink-muted hover:bg-surface-3 hover:text-ink',
            )}
          >
            {Icon && <Icon size={size === 'sm' ? 12 : 13} aria-hidden="true" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
