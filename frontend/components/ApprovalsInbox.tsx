'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import type { TranslationKey } from '@/lib/i18n/translations';

interface ApprovalRow {
  id: string;
  pin: string;
  work_date: string | null;
  action: string;
  payload: { timestamp?: string; old_timestamp?: string; status?: string };
  full_name: string | null;
  /** 'self_service' when the employee filed the correction themselves (Phase 7). */
  source?: string | null;
  note?: string | null;
}

const ACTION_KEY: Record<string, TranslationKey> = {
  add: 'approvals_action_add',
  edit: 'approvals_action_edit',
  delete: 'approvals_action_delete',
};

/**
 * Manual punch edits made by an operator wait here until an owner/admin decides.
 * Without this queue the edit would either be applied silently (the old
 * behaviour) or be impossible to make at all.
 */
export function ApprovalsInbox({ refreshKey = 0 }: { refreshKey?: number }) {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const { t } = useLanguage();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/attendance/approvals');
      const json = await res.json();
      if (res.ok) setRows(Array.isArray(json) ? json : []);
    } catch {
      // Non-critical.
    }
  }, []);

  useEffect(() => {
    // Deferred off the effect path: the loader sets state, and calling it
    // synchronously here is what react-hooks/set-state-in-effect flags.
    void Promise.resolve().then(load);
  }, [load, refreshKey]);

  const decide = useCallback(
    async (id: string, decision: 'approve' | 'reject') => {
      setBusy(id);
      try {
        const res = await fetch('/api/attendance/approvals', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, decision }),
        });
        const json = await res.json();
        if (res.ok) {
          toast.success(decision === 'approve' ? t('approvals_approved') : t('approvals_rejected'));
          setRows((prev) => prev.filter((row) => row.id !== id));
        } else {
          toast.error(json.error || t('approvals_failed'));
        }
      } catch {
        toast.error(t('approvals_failed'));
      } finally {
        setBusy(null);
      }
    },
    [t, toast],
  );

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={t('approvals_title')}
        description={t('approvals_desc')}
        icon={ClipboardCheck}
        actions={
          <Badge tone="info" size="sm" dot>
            {rows.length}
          </Badge>
        }
      />
      <div className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-info-line bg-info-soft text-info">
              <ClipboardCheck size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                <span className="truncate">{row.full_name || `PIN ${row.pin}`}</span>
                {row.source === 'self_service' && (
                  <Badge tone="brand" size="sm">
                    {t('approvals_source_self')}
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-subtle">
                <span>{t(ACTION_KEY[row.action] ?? 'approvals_action_edit')}</span>
                <span>•</span>
                <span className="font-mono">
                  {row.payload?.timestamp?.slice(0, 19).replace('T', ' ') ||
                    row.work_date ||
                    '—'}
                </span>
              </p>
              {row.note && (
                <p className="mt-1 line-clamp-2 text-[11px] text-ink-muted">{row.note}</p>
              )}
            </div>
            <div className="inline-flex items-center gap-1">
              <Button
                variant="success"
                size="sm"
                icon={Check}
                loading={busy === row.id}
                onClick={() => void decide(row.id, 'approve')}
              >
                {t('leave_btn_approve')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                className="text-danger"
                onClick={() => void decide(row.id, 'reject')}
              >
                {t('leave_btn_reject')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
