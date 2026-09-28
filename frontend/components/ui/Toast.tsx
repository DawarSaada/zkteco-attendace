'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { IconComponent } from '@/components/ui/icon';
import type { ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  text: ReactNode;
  tone: ToastTone;
  durationMs: number;
}

interface ToastApi {
  toast: (text: ReactNode, tone?: ToastTone, durationMs?: number) => void;
  success: (text: ReactNode, durationMs?: number) => void;
  error: (text: ReactNode, durationMs?: number) => void;
  warning: (text: ReactNode, durationMs?: number) => void;
  info: (text: ReactNode, durationMs?: number) => void;
}

const ToastContext = createContext<ToastApi>({
  toast: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const TONE_STYLES: Record<
  ToastTone,
  { wrap: string; icon: IconComponent; iconClass: string; bar: string }
> = {
  success: {
    wrap: 'border-success-line',
    icon: CheckCircle2,
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
  },
  error: {
    wrap: 'border-danger-line',
    icon: XCircle,
    iconClass: 'text-rose-600 dark:text-rose-400',
    bar: 'bg-rose-500',
  },
  warning: {
    wrap: 'border-warning-line',
    icon: AlertTriangle,
    iconClass: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
  },
  info: {
    wrap: 'border-brand-line',
    icon: Info,
    iconClass: 'text-blue-600 dark:text-blue-400',
    bar: 'bg-blue-500',
  },
};

/**
 * Renders a fixed toast region and exposes `useToast()`.
 *
 * The region is a persistent `aria-live` container, so assistive technology
 * announces each notification — the inline banners this replaces mutated the
 * DOM silently.
 */
export function ToastProvider({
  children,
  closeLabel = 'Dismiss',
}: {
  children: ReactNode;
  closeLabel?: string;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (text: ReactNode, tone: ToastTone = 'info', durationMs = 4200) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, text, tone, durationMs }]);
      if (durationMs > 0) {
        const timer = window.setTimeout(() => dismiss(id), durationMs);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (text, durationMs) => toast(text, 'success', durationMs),
      error: (text, durationMs) => toast(text, 'error', durationMs),
      warning: (text, durationMs) => toast(text, 'warning', durationMs),
      info: (text, durationMs) => toast(text, 'info', durationMs),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed top-4 end-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2.5"
      >
        {items.map((item) => {
          const tone = TONE_STYLES[item.tone];
          const Icon = tone.icon;
          return (
            <div
              key={item.id}
              role={item.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'sheen-top animate-in slide-in-from-top pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border bg-surface/85 px-4 py-3.5 shadow-pop backdrop-blur-xl duration-300',
                tone.wrap,
              )}
            >
              <Icon
                size={17}
                className={cn('mt-0.5 shrink-0', tone.iconClass)}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 text-xs font-medium leading-relaxed text-ink">
                {item.text}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label={closeLabel}
                className="-me-1 -mt-0.5 cursor-pointer rounded-lg p-1 text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X size={14} aria-hidden="true" />
              </button>
              <span
                aria-hidden="true"
                style={
                  item.durationMs > 0
                    ? { animationDuration: `${item.durationMs}ms` }
                    : undefined
                }
                className={cn(
                  'absolute inset-x-0 bottom-0 h-0.5 origin-left opacity-50 rtl:origin-right',
                  tone.bar,
                  item.durationMs > 0 && 'toast-progress',
                )}
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
