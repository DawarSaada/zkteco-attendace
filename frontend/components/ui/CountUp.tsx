'use client';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Animates a number up to its target on mount.
 *
 * Every state change happens inside a `requestAnimationFrame` callback, never
 * synchronously in the effect body, so it does not trigger cascading renders.
 */
export function CountUp({
  value,
  durationMs = 900,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: {
  value: number;
  durationMs?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || !Number.isFinite(value)) {
      const immediate = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(immediate);
    }

    let frame = 0;
    let start = 0;

    const tick = (timestamp: number) => {
      if (start === 0) start = timestamp;
      const progress = Math.min(1, (timestamp - start) / durationMs);
      // easeOutCubic — fast start, gentle settle.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(value * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  const rendered = display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className={cn('tabular-nums', className)} data-numeric>
      {prefix}
      {rendered}
      {suffix}
    </span>
  );
}
