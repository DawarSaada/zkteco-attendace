'use client';
import { useId } from 'react';
import { cn } from '@/lib/utils/cn';
import type { CSSProperties } from 'react';

/* ============================================================ *
 *  Dependency-free charts.
 *
 *  Everything is plain SVG scaled by a CSS box, so the app gets
 *  real data visualisation without shipping a charting library.
 * ============================================================ */

export type ChartTone = 'aurora' | 'brand' | 'success' | 'danger' | 'warning' | 'info';

const STROKE: Record<ChartTone, string> = {
  aurora: 'var(--accent-1)',
  brand: 'var(--brand)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

const FILL: Record<ChartTone, string> = {
  aurora: 'var(--accent-2)',
  brand: 'var(--brand)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

function safeId(raw: string) {
  return raw.replace(/[^a-zA-Z0-9]/g, '');
}

/* ------------------------------------------------------------ *
 *  Sparkline
 * ------------------------------------------------------------ */

export function Sparkline({
  data,
  height = 44,
  tone = 'aurora',
  className,
  showEndPoint = true,
}: {
  data: number[];
  height?: number;
  tone?: ChartTone;
  className?: string;
  showEndPoint?: boolean;
}) {
  const gradientId = `spark-${safeId(useId())}`;

  if (data.length === 0) return null;

  // A single sample still renders as a flat line rather than nothing.
  const series = data.length === 1 ? [data[0], data[0]] : data;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min || 1;
  const stepX = 100 / (series.length - 1);

  const coords = series.map((value, index) => {
    const x = index * stepX;
    const y = 100 - ((value - min) / span) * 88 - 6;
    return { x, y };
  });

  const line = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L100,100 L0,100 Z`;
  const last = coords[coords.length - 1];

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn('w-full overflow-visible', className)}
      style={{ height }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={FILL[tone]} stopOpacity="0.32" />
          <stop offset="100%" stopColor={FILL[tone]} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={STROKE[tone]}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />

      {showEndPoint && (
        <circle
          cx={last.x}
          cy={last.y}
          r={2}
          fill={STROKE[tone]}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/* ------------------------------------------------------------ *
 *  Bar chart
 * ------------------------------------------------------------ */

export interface BarDatum {
  label: string;
  value: number;
  /** Extra detail shown in the hover tooltip and the accessible title. */
  hint?: string;
}

export function BarChart({
  data,
  height = 160,
  suffix = '',
  tone = 'aurora',
  className,
  labelEvery,
  formatValue,
}: {
  data: BarDatum[];
  height?: number;
  suffix?: string;
  tone?: ChartTone;
  className?: string;
  /** Show every Nth x-axis label. Defaults to a spacing that avoids collisions. */
  labelEvery?: number;
  formatValue?: (value: number) => string;
}) {
  if (data.length === 0) return null;

  const max = Math.max(1, ...data.map((datum) => datum.value));
  const step = labelEvery ?? Math.max(1, Math.ceil(data.length / 7));
  const format = formatValue ?? ((value: number) => String(value));

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((datum, index) => {
          const percent = (datum.value / max) * 100;
          return (
            <div
              key={`${datum.label}-${index}`}
              /* The tooltip carries the exact figure, so the bars themselves
                 can stay purely visual. */
              title={`${datum.label}: ${format(datum.value)}${suffix}${datum.hint ? ` — ${datum.hint}` : ''}`}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center"
            >
              {datum.value > 0 && (
                <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full scale-90 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-bold whitespace-nowrap text-ink opacity-0 shadow-lift transition-all duration-150 group-hover:scale-100 group-hover:opacity-100">
                  {format(datum.value)}
                  {suffix}
                </span>
              )}

              <div
                style={
                  {
                    height: `${Math.max(percent, datum.value > 0 ? 4 : 1.5)}%`,
                    '--ui-i': Math.min(index, 18),
                    // Aurora uses the gradient utility; other tones are flat.
                    ...(tone === 'aurora' ? null : { background: STROKE[tone] }),
                  } as CSSProperties
                }
                className={cn(
                  'bar-rise w-full rounded-t-[5px] transition-[filter,opacity] duration-150',
                  datum.value > 0
                    ? cn(
                        'opacity-85 group-hover:opacity-100',
                        tone === 'aurora' && 'aurora-bg',
                      )
                    : 'bg-surface-3',
                )}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {data.map((datum, index) => (
          <div
            key={`${datum.label}-label-${index}`}
            className="min-w-0 flex-1 truncate text-center text-[10px] font-medium text-ink-subtle"
            data-numeric
          >
            {index % step === 0 ? datum.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ *
 *  Donut
 * ------------------------------------------------------------ */

export interface DonutSegment {
  label: string;
  value: number;
  tone: ChartTone;
}

export function Donut({
  segments,
  size = 168,
  thickness = 14,
  centerLabel,
  centerSub,
  className,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = segments.filter((segment) => segment.value > 0).length > 1 ? 2 : 0;

  let offset = 0;

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="animate-in zoom-in-95 -rotate-90 duration-500"
        role="img"
        aria-label={segments
          .map((segment) => `${segment.label}: ${segment.value}`)
          .join(', ')}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={thickness}
        />

        {total > 0 &&
          segments.map((segment) => {
            if (segment.value <= 0) return null;
            const length = (segment.value / total) * circumference;
            const dash = Math.max(length - gap, 1);
            const element = (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={STROKE[segment.tone]}
                strokeWidth={thickness}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                className="transition-[stroke-dasharray,stroke-dashoffset] duration-700 ease-out"
              />
            );
            offset += length;
            return element;
          })}
      </svg>

      {(centerLabel || centerSub) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && (
            <span
              data-numeric
              className="text-2xl font-extrabold tracking-tight text-ink"
            >
              {centerLabel}
            </span>
          )}
          {centerSub && (
            <span className="mt-0.5 text-[10px] font-semibold tracking-wider text-ink-subtle uppercase">
              {centerSub}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function ChartLegend({
  segments,
  className,
}: {
  segments: DonutSegment[];
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <ul className={cn('space-y-2.5', className)}>
      {segments.map((segment) => (
        <li key={segment.label} className="flex items-center gap-3 text-xs">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: STROKE[segment.tone] }}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate font-medium text-ink-muted">
            {segment.label}
          </span>
          <span
            className="shrink-0 font-bold text-ink"
            data-numeric
          >
            {segment.value}
            {total > 0 && (
              <span className="ms-1.5 text-[10px] font-medium text-ink-subtle">
                {Math.round((segment.value / total) * 100)}%
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
