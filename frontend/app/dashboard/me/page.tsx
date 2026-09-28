'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Calendar,
  CalendarOff,
  CheckCircle2,
  Clock,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricTile } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { formatHours } from '@/lib/attendance/summary';
import type { AttendanceDayStatus, SelfServicePayload, SelfServiceRequest } from '@/types';
import type { TranslationKey } from '@/lib/i18n/translations';

/**
 * "My attendance" — the employee-facing page.
 *
 * Mobile-first on purpose: this is the page people open on a phone. It shows the
 * same computed rows the payroll reports use, plus the payslip totals, and it
 * lets the employee file a correction instead of walking to the HR desk.
 *
 * An employee can see nothing but their own record: the pin is resolved from the
 * session on the server, never passed up from here.
 */

const STATUS_TONE: Record<AttendanceDayStatus, BadgeTone> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  incomplete: 'info',
  leave: 'brand',
  holiday: 'neutral',
  off: 'neutral',
};

const STATUS_KEY: Record<AttendanceDayStatus, TranslationKey> = {
  present: 'me_status_present',
  late: 'me_status_late',
  absent: 'me_status_absent',
  incomplete: 'me_status_incomplete',
  leave: 'me_status_leave',
  holiday: 'me_status_holiday',
  off: 'me_status_off',
};

const WEEKDAY_KEY: TranslationKey[] = [
  'weekday_sun',
  'weekday_mon',
  'weekday_tue',
  'weekday_wed',
  'weekday_thu',
  'weekday_fri',
  'weekday_sat',
];

const ACTION_KEY: Record<string, TranslationKey> = {
  add: 'me_correction_action_add',
  edit: 'me_correction_action_edit',
  delete: 'me_correction_action_delete',
};

const REQUEST_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

const REQUEST_KEY: Record<string, TranslationKey> = {
  pending: 'me_request_pending',
  approved: 'me_request_approved',
  rejected: 'me_request_rejected',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The last twelve months, newest first, as `YYYY-MM`. */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  });
}

function monthBounds(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const today = toKey(new Date());
  const from = `${month}-01`;
  const to = `${month}-${pad(last)}`;
  // Never ask for days that have not happened yet.
  return { from, to: to > today ? today : to };
}

function dayLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
}

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(11, 16);
}

interface SummaryResult {
  ok: boolean;
  data: SelfServicePayload & { error?: string };
}

/** Module-level so the effect can await it without any setState in between. */
async function fetchSummary(month: string): Promise<SummaryResult> {
  const { from, to } = monthBounds(month);
  const res = await fetch(`/api/me/summary?from=${from}&to=${to}`);
  const data = (await res.json()) as SelfServicePayload & { error?: string };
  return { ok: res.ok, data };
}

export default function MyAttendancePage() {
  const { t } = useLanguage();
  const toast = useToast();

  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(() => toKey(new Date()).slice(0, 7));
  const [payload, setPayload] = useState<SelfServicePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formDate, setFormDate] = useState('');
  const [formAction, setFormAction] = useState<'add' | 'edit' | 'delete'>('add');
  const [formTime, setFormTime] = useState('09:00');
  const [formOldTime, setFormOldTime] = useState('');
  const [formNote, setFormNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /** Imperative reload, used by the refresh button and after a submission. */
  const load = useCallback(async () => {
    try {
      const result = await fetchSummary(month);
      if (result.ok) {
        setPayload(result.data);
      } else {
        toast.error(result.data.error || t('me_load_failed'));
      }
    } catch {
      toast.error(t('me_load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [month, t, toast]);

  useEffect(() => {
    let cancelled = false;
    fetchSummary(month)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setPayload(result.data);
        else toast.error(result.data.error || t('me_load_failed'));
      })
      .catch(() => {
        if (!cancelled) toast.error(t('me_load_failed'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, t, toast]);

  const openModal = (dateKey?: string) => {
    const today = toKey(new Date());
    setFormDate(dateKey ?? today);
    setFormAction('add');
    setFormTime('09:00');
    setFormOldTime('');
    setFormNote('');
    setIsModalOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const body: Record<string, unknown> = {
        work_date: formDate,
        action: formAction,
        note: formNote,
      };
      if (formAction === 'add' || formAction === 'edit') {
        body.timestamp = `${formDate}T${formTime}:00.000Z`;
      }
      if (formAction === 'edit') {
        body.old_timestamp = formOldTime ? `${formDate}T${formOldTime}:00.000Z` : undefined;
      }

      const res = await fetch('/api/me/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };

      if (res.ok) {
        toast.success(t('me_correction_success'));
        setIsModalOpen(false);
        await load();
      } else {
        toast.error(json.error || t('me_correction_failed'));
      }
    } catch {
      toast.error(t('me_correction_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const summary = payload?.summary;
  const days = payload?.days ?? [];
  const requests: SelfServiceRequest[] = payload?.requests ?? [];

  return (
    <div className="animate-in fade-in space-y-5 duration-200 sm:space-y-6">
      <PageHeader
        title={t('me_title')}
        description={t('me_subtitle')}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setIsLoading(true);
                void load();
              }}
              aria-label={t('refresh')}
              title={t('refresh')}
            >
              <RefreshCw size={16} />
            </Button>
            {payload?.linked && (
              <Button icon={Plus} onClick={() => openModal()}>
                {t('me_correction_btn')}
              </Button>
            )}
          </>
        }
      />

      {isLoading && !payload && (
        <Card className="p-6">
          <p className="text-sm text-ink-muted">{t('loading')}</p>
        </Card>
      )}

      {!isLoading && payload && !payload.linked && (
        <Card className="p-6">
          <EmptyState
            icon={CalendarOff}
            title={t('me_not_linked_title')}
            description={t('me_not_linked_desc')}
            tone="dashed"
          />
        </Card>
      )}

      {payload?.linked && (
        <>
          <Card className="sheen-top flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-ink">
                {payload.employee?.full_name || `PIN ${payload.employee?.pin ?? ''}`}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {payload.employee?.branch || '—'}
                {payload.employee?.department ? ` • ${payload.employee.department}` : ''}
                {payload.shift?.name ? ` • ${payload.shift.name}` : ''}
              </p>
            </div>
            <Field label={t('me_month')} className="w-full sm:w-44">
              <Select
                value={month}
                onChange={(event) => {
                  setIsLoading(true);
                  setMonth(event.target.value);
                }}
                aria-label={t('me_month')}
              >
                {months.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricTile
              label={t('me_metric_worked')}
              value={Math.round(((summary?.workedMinutes ?? 0) / 60) * 100) / 100}
              decimals={2}
              icon={Clock}
              tone="success"
            />
            <MetricTile
              label={t('me_metric_overtime')}
              value={Math.round(((summary?.overtimeMinutes ?? 0) / 60) * 100) / 100}
              decimals={2}
              icon={Activity}
              tone="brand"
            />
            <MetricTile
              label={t('me_metric_late')}
              value={summary?.lateDays ?? 0}
              icon={AlertCircle}
              tone="warning"
            />
            <MetricTile
              label={t('me_metric_absent')}
              value={summary?.absentDays ?? 0}
              icon={CalendarOff}
              tone="danger"
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader
                title={t('me_days_title')}
                description={`${payload.range.from} → ${payload.range.to}`}
                icon={Calendar}
                actions={
                  <Badge tone={days.length > 0 ? 'info' : 'neutral'} size="sm">
                    {days.length}
                  </Badge>
                }
              />
              <div className="divide-y divide-line">
                {days.map((day) => (
                  <button
                    key={day.work_date}
                    type="button"
                    onClick={() => openModal(day.work_date)}
                    className="flex w-full cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-[4.5rem]">
                      <p className="font-mono text-sm font-bold text-ink" data-numeric>
                        {dayLabel(day.work_date)}
                      </p>
                      <p className="text-[10px] text-ink-subtle">
                        {t(
                          WEEKDAY_KEY[new Date(`${day.work_date}T00:00:00Z`).getUTCDay()] ??
                            'weekday_sun',
                        )}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[day.status] ?? 'neutral'} size="sm" dot>
                      {t(STATUS_KEY[day.status] ?? 'me_status_off')}
                    </Badge>
                    <span className="font-mono text-xs text-ink-muted" data-numeric>
                      {timeLabel(day.first_in)} → {timeLabel(day.last_out)}
                    </span>
                    <span className="ms-auto font-mono text-xs font-semibold text-ink" data-numeric>
                      {formatHours(day.worked_minutes ?? 0)}
                    </span>
                    {day.overtime_minutes ? (
                      <Badge tone="brand" size="sm">
                        +{formatHours(day.overtime_minutes)}
                      </Badge>
                    ) : null}
                  </button>
                ))}

                {days.length === 0 && (
                  <div className="px-4 py-8">
                    <EmptyState
                      icon={Calendar}
                      title={
                        payload.engineApplied === false ? t('me_engine_pending') : t('me_no_days')
                      }
                    />
                  </div>
                )}
              </div>
            </Card>

            <div className="space-y-5">
              <Card className="p-5">
                <h3 className="text-sm font-bold text-ink">{t('me_summary_title')}</h3>
                <p className="mt-1 text-xs text-ink-muted">{t('me_summary_desc')}</p>

                <dl className="mt-4 space-y-2.5 text-xs">
                  {[
                    ['me_row_worked', formatHours(summary?.workedMinutes ?? 0)],
                    ['me_row_expected', formatHours(summary?.expectedMinutes ?? 0)],
                    ['me_row_overtime', formatHours(summary?.overtimeMinutes ?? 0)],
                    ['me_row_late_minutes', formatHours(summary?.lateMinutes ?? 0)],
                    ['me_row_early', formatHours(summary?.earlyLeaveMinutes ?? 0)],
                    [
                      'me_row_rate',
                      `${Math.round((summary?.attendanceRate ?? 0) * 100)}%`,
                    ],
                    ['me_present', String(summary?.presentDays ?? 0)],
                    ['me_late_days', String(summary?.lateDays ?? 0)],
                    ['me_incomplete', String(summary?.incompleteDays ?? 0)],
                    ['me_absent_days', String(summary?.absentDays ?? 0)],
                    ['me_leave_days', String(summary?.leaveDays ?? 0)],
                    ['me_holiday_days', String(summary?.holidayDays ?? 0)],
                    ['me_off_days', String(summary?.offDays ?? 0)],
                  ].map(([labelKey, value]) => (
                    <div key={labelKey} className="flex items-center justify-between gap-3">
                      <dt className="text-ink-muted">{t(labelKey as TranslationKey)}</dt>
                      <dd className="font-mono font-semibold text-ink" data-numeric>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>

              <Card>
                <CardHeader
                  title={t('me_requests_title')}
                  icon={CheckCircle2}
                  actions={
                    requests.length > 0 ? (
                      <Badge tone="info" size="sm">
                        {requests.length}
                      </Badge>
                    ) : undefined
                  }
                />
                <div className="divide-y divide-line">
                  {requests.map((request) => (
                    <div key={request.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={REQUEST_TONE[request.status] ?? 'neutral'} size="sm" dot>
                          {t(REQUEST_KEY[request.status] ?? 'me_request_pending')}
                        </Badge>
                        <span className="font-mono text-xs font-semibold text-ink" data-numeric>
                          {request.work_date}
                        </span>
                        <span className="text-[11px] text-ink-subtle">
                          {t(ACTION_KEY[request.action] ?? 'me_correction_action_add')}
                        </span>
                      </div>
                      {request.note && (
                        <p className="mt-1 text-[11px] text-ink-muted">{request.note}</p>
                      )}
                    </div>
                  ))}

                  {requests.length === 0 && (
                    <div className="px-4 py-6">
                      <EmptyState icon={CheckCircle2} title={t('me_requests_empty')} />
                    </div>
                  )}
                </div>
              </Card>

              {(payload.openExceptions?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader title={t('me_exceptions_title')} icon={AlertCircle} />
                  <div className="divide-y divide-line">
                    {payload.openExceptions?.map((row) => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                      >
                        <span className="font-mono text-ink" data-numeric>
                          {row.work_date}
                        </span>
                        <span className="text-ink-subtle">{row.kind}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('me_correction_title')}
        description={t('me_correction_desc')}
        closeLabel={t('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="correction-form" loading={isSaving}>
              {t('me_correction_submit')}
            </Button>
          </>
        }
      >
        <form id="correction-form" onSubmit={submit} className="space-y-4">
          <Field label={t('me_correction_date')} required>
            <Input
              type="date"
              required
              value={formDate}
              onChange={(event) => setFormDate(event.target.value)}
            />
          </Field>

          <Field label={t('me_correction_action')} required>
            <Select
              value={formAction}
              onChange={(event) =>
                setFormAction(event.target.value as 'add' | 'edit' | 'delete')
              }
            >
              <option value="add">{t('me_correction_action_add')}</option>
              <option value="edit">{t('me_correction_action_edit')}</option>
              <option value="delete">{t('me_correction_action_delete')}</option>
            </Select>
          </Field>

          {(formAction === 'add' || formAction === 'edit') && (
            <Field label={t('me_correction_time')} required>
              <Input
                type="time"
                required
                value={formTime}
                onChange={(event) => setFormTime(event.target.value)}
                className="text-center font-mono"
              />
            </Field>
          )}

          {formAction === 'edit' && (
            <Field label={t('me_correction_old_time')} required hint={t('me_correction_old_hint')}>
              <Input
                type="time"
                required
                value={formOldTime}
                onChange={(event) => setFormOldTime(event.target.value)}
                className="text-center font-mono"
              />
            </Field>
          )}

          <Field label={t('me_correction_note')} hint={t('me_correction_note_hint')}>
            <Textarea
              rows={3}
              value={formNote}
              onChange={(event) => setFormNote(event.target.value)}
              placeholder={t('me_correction_note_placeholder')}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
