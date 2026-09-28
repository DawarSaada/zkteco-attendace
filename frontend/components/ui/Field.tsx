'use client';
import { createContext, useContext, useId } from 'react';
import { cn } from '@/lib/utils/cn';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/**
 * Field wires a label, hint and error message to its control, so every input
 * is reachable by screen readers without hand-maintaining `id`/`htmlFor`
 * pairs — the project previously matched them up by hand (and missed several).
 */
const FieldIdContext = createContext<{ id?: string; describedBy?: string }>({});

export function Field({
  label,
  hint,
  error,
  required,
  className,
  labelClassName,
  children,
  labelAction,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  children: ReactNode;
  labelAction?: ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <label
              htmlFor={id}
              className={cn(
                'block text-xs font-semibold text-ink-muted',
                labelClassName,
              )}
            >
              {label}
              {required && (
                <span className="ms-0.5 text-rose-500" aria-hidden="true">
                  *
                </span>
              )}
            </label>
          )}
          {labelAction}
        </div>
      )}
      <FieldIdContext.Provider value={{ id, describedBy }}>
        {children}
      </FieldIdContext.Provider>
      {error ? (
        <p id={errorId} className="text-[11px] font-medium text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-[11px] leading-relaxed text-ink-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/**
 * `min-w-0` matters on small screens: a `<select>` (and an `<input>`) has an
 * intrinsic width — for a select, the widest option — and without it the control
 * refuses to shrink, which widens its grid or flex track and pushes the whole
 * page into horizontal scroll.
 */
export const controlClass =
  'w-full min-w-0 rounded-xl border border-line bg-surface-2/70 px-3 text-sm text-ink shadow-[inset_0_1px_0_0_var(--surface-sheen)] transition-[background-color,border-color,box-shadow] duration-200 outline-none placeholder:text-ink-subtle hover:border-line-strong focus:border-brand focus:bg-surface focus:ring-4 focus:ring-brand-soft disabled:cursor-not-allowed disabled:opacity-60';

export function Input({
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const ctx = useContext(FieldIdContext);
  const inputId = id ?? ctx.id;
  return (
    <input
      id={inputId}
      aria-describedby={rest['aria-describedby'] ?? ctx.describedBy}
      className={cn(controlClass, 'h-10', className)}
      {...rest}
    />
  );
}

export function Select({
  className,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const ctx = useContext(FieldIdContext);
  const selectId = id ?? ctx.id;
  return (
    <select
      id={selectId}
      aria-describedby={rest['aria-describedby'] ?? ctx.describedBy}
      className={cn(controlClass, 'h-10 cursor-pointer pe-2', className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ctx = useContext(FieldIdContext);
  const textareaId = id ?? ctx.id;
  return (
    <textarea
      id={textareaId}
      aria-describedby={rest['aria-describedby'] ?? ctx.describedBy}
      className={cn(controlClass, 'resize-y py-2.5 leading-relaxed', className)}
      {...rest}
    />
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60',
          checked
            ? 'border-blue-600 bg-blue-600'
            : 'border-line-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'start-[1.15rem]' : 'start-0.5',
          )}
        />
      </button>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn(
            'block cursor-pointer text-xs font-semibold text-ink',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-subtle">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
