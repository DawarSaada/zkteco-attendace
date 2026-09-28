'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ShieldOff } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import type { TranslationKey } from '@/lib/i18n/translations';

interface ExceptionRow {
  id: string;
  pin: string;
  work_date: string;
  kind: string;
  state: string;
  reason_code: string | null;
  full_name: string | null;
}

const KIND_KEY: Record<string, TranslationKey> = {
  missing_check_out: 'exception_missing_check_out',
  missing_check_in: 'exception_missing_check_in',
  duplicate: 'exception_duplicate',
  unmatched_device: 'exception_unmatched_device',
  other: 'exception_other',
};

const REASONS: { value: string; key: TranslationKey }[] = [
  { value: 'employee_confirmed', key: 'exc_reason_confirmed' },
  { value: 'forgot_punch', key: 'exc_reason_forgot' },
  { value: 'device_error', key: 'exc_reason_device' },
  { value: 'other', key: 'exc_reason_other' },
];

/**
 * The HR clerk's queue. Every incomplete day the engine produces lands here with
 * an owner and a state, so a missing check-out is resolved rather than guessed at.
 */
export function ExceptionsInbox({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { t } = useLanguage();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/exceptions?state=open');
      const json = await res.json();
      if (res.ok) setRows(Array.isArray(json) ? json : []);
    } catch {
      // Non-critical: the report table still renders without the inbox.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const resolve = useCallback(
    async (id: string, state: 'resolved' | 'ignored') => {
      setBusy(id);
      try {
        const res = await fetch('/api/exceptions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            state,
            reason_code: reasons[id] || 'other',
          }),
        });
        const json = await res.json();
        if (res.ok) {
          toast.success(t('exceptions_resolved'));
          setRows((prev) => prev.filter((row) => row.id !== id));
        } else {
          toast.error(json.error || t('exceptions_resolve_failed'));
        }
      } catch {
        toast.error(t('exceptions_resolve_failed'));
      } finally {
        setBusy(null);
      }
    },
    [reasons, t, toast],
  );

  const byKind = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row) => map.set(row.kind, (map.get(row.kind) ?? 0) + 1));
    return map;
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={t('exceptions_title')}
        description={t('exceptions_desc')}
        icon={AlertTriangle}
        actions={
          <Badge tone="warning" size="sm" dot>
            {rows.length}
          </Badge>
        }
      />

      {byKind.size > 1 && (
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          {[...byKind.entries()].map(([kind, count]) => (
            <Badge key={kind} tone="neutral" size="sm">
              {t(KIND_KEY[kind] ?? 'exception_other')}: {count}
            </Badge>
          ))}
        </div>
      )}

      <div className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="glow-current grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-warning-line bg-warning-soft text-warning">
              <AlertTriangle size={15} aria-hidden="true" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {row.full_name || `PIN ${row.pin}`}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
                <span className="font-mono">{row.work_date}</span>
                <span>•</span>
                <span>{t(KIND_KEY[row.kind] ?? 'exception_other')}</span>
              </p>
            </div>

            <Select
              aria-label={t('exceptions_reason')}
              className="w-44"
              value={reasons[row.id] ?? 'forgot_punch'}
              onChange={(event) =>
                setReasons((prev) => ({ ...prev, [row.id]: event.target.value }))
              }
            >
              {REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {t(reason.key)}
                </option>
              ))}
            </Select>

            <div className="inline-flex items-center gap-1">
              <Button
                variant="success"
                size="sm"
                icon={Check}
                loading={busy === row.id}
                onClick={() => void resolve(row.id, 'resolved')}
              >
                {t('exceptions_resolve')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={ShieldOff}
                onClick={() => void resolve(row.id, 'ignored')}
              >
                {t('exceptions_ignore')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
