'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Edit,
  MailCheck,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ChartLegend, Donut } from '@/components/ui/Charts';
import { MetricTile } from '@/components/ui/StatCard';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/Skeleton';
import {
  Table,
  TableCard,
  TableMessageRow,
  TableScroll,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import type {
  ReportAutomation,
  ReportAutomationLog,
  ReportCadence,
  ReportType,
} from '@/types';
import type { TranslationKey } from '@/lib/i18n/translations';
import type { CSSProperties } from 'react';

const FORMAT_LABEL: Record<string, TranslationKey> = {
  excel: 'auto_format_excel_short',
  pdf: 'auto_format_pdf_short',
  both: 'auto_format_both_short',
};

const REPORT_TYPE_LABEL: Record<string, TranslationKey> = {
  timecard: 'report_timecard',
  exceptions: 'report_exceptions',
  absence: 'report_absence',
  overtime: 'report_overtime',
  rollup: 'report_rollup',
  late: 'report_late',
};

const CADENCE_LABEL: Record<string, TranslationKey> = {
  monthly: 'cadence_monthly',
  weekly: 'cadence_weekly',
  daily: 'cadence_daily',
};

/** 0 = Sunday … 6 = Saturday, matching the scheduler's ISO weekday convention. */
const WEEKDAY_LABEL: TranslationKey[] = [
  'weekday_sun',
  'weekday_mon',
  'weekday_tue',
  'weekday_wed',
  'weekday_thu',
  'weekday_fri',
  'weekday_sat',
];

function toDispatchTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value;
}

export default function AutomationPage() {
  const [rules, setRules] = useState<ReportAutomation[]>([]);
  const [logs, setLogs] = useState<ReportAutomationLog[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ReportAutomation | null>(null);
  const [modalBranch, setModalBranch] = useState('all');
  const [modalEmails, setModalEmails] = useState('');
  const [modalFormat, setModalFormat] = useState<'excel' | 'pdf' | 'both'>('both');
  const [modalReportType, setModalReportType] = useState<ReportType>('timecard');
  const [modalCadence, setModalCadence] = useState<ReportCadence>('monthly');
  const [modalDispatchTime, setModalDispatchTime] = useState('08:00');
  const [modalStartDay, setModalStartDay] = useState(26);
  const [modalEndDay, setModalEndDay] = useState(25);
  const [modalDispatchDay, setModalDispatchDay] = useState(26);
  const [modalIsActive, setModalIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ReportAutomation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { t } = useLanguage();
  const toast = useToast();

  const successCount = logs.filter((log) => log.status === 'SUCCESS').length;
  const outcomeSegments = [
    { label: t('auto_log_success'), value: successCount, tone: 'success' as const },
    {
      label: t('auto_log_failed'),
      value: logs.length - successCount,
      tone: 'danger' as const,
    },
  ];
  const recipientCount = rules.reduce(
    (sum, rule) => sum + rule.recipient_emails.length,
    0,
  );

  const fetchData = useCallback(async () => {
    try {
      const [automationRes, employeesRes, devicesRes] = await Promise.all([
        fetch('/api/automation'),
        fetch('/api/employees'),
        fetch('/api/devices'),
      ]);

      if (automationRes.ok) {
        const automationData = await automationRes.json();
        setRules(automationData.rules || []);
        setLogs(automationData.logs || []);
      } else {
        toast.error(t('auto_fetch_failed'));
      }

      const branchSet = new Set<string>();
      if (employeesRes.ok) {
        const employees = await employeesRes.json();
        (Array.isArray(employees) ? employees : []).forEach(
          (employee: { branch?: string | null }) => {
            if (employee.branch) branchSet.add(employee.branch);
          },
        );
      }
      if (devicesRes.ok) {
        const devices = await devicesRes.json();
        (Array.isArray(devices) ? devices : []).forEach(
          (device: { branch?: string | null }) => {
            if (device.branch) branchSet.add(device.branch);
          },
        );
      }

      const uniqueBranches = Array.from(branchSet).filter(Boolean);
      setBranches(uniqueBranches);
      setModalBranch((prev) => (prev === 'all' ? uniqueBranches[0] || 'all' : prev));
    } catch {
      toast.error(t('auto_fetch_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openCreateModal = () => {
    setEditingRule(null);
    setModalBranch(branches[0] || 'all');
    setModalEmails('');
    setModalFormat('both');
    setModalReportType('timecard');
    setModalCadence('monthly');
    setModalDispatchTime('08:00');
    setModalStartDay(26);
    setModalEndDay(25);
    setModalDispatchDay(26);
    setModalIsActive(true);
    setIsModalOpen(true);
  };

  const openEditModal = (rule: ReportAutomation) => {
    setEditingRule(rule);
    setModalBranch(rule.branch);
    setModalEmails(rule.recipient_emails.join(', '));
    setModalFormat(rule.report_format);
    setModalReportType(rule.report_type ?? 'timecard');
    setModalCadence(rule.cadence ?? 'monthly');
    setModalDispatchTime((rule.dispatch_time || '08:00:00').slice(0, 5));
    setModalStartDay(rule.cycle_start_day || 26);
    setModalEndDay(rule.cycle_end_day || 25);
    setModalDispatchDay(rule.dispatch_day ?? 26);
    setModalIsActive(rule.is_active);
    setIsModalOpen(true);
  };

  const handleSaveRule = async (event: React.FormEvent) => {
    event.preventDefault();

    const emailList = modalEmails
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean);

    if (emailList.length === 0) {
      toast.warning(t('auto_no_recipients'));
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRule?.id,
          branch: modalBranch,
          recipient_emails: emailList,
          cycle_start_day: Number(modalStartDay),
          cycle_end_day: Number(modalEndDay),
          dispatch_day: Number(modalDispatchDay),
          dispatch_time: toDispatchTime(modalDispatchTime),
          report_format: modalFormat,
          report_type: modalReportType,
          cadence: modalCadence,
          is_active: modalIsActive,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(
          editingRule ? t('auto_update_success') : t('auto_create_success'),
        );
        setIsModalOpen(false);
        await fetchData();
      } else {
        toast.error(data.error || t('auto_save_failed'));
      }
    } catch {
      toast.error(t('auto_save_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRule = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/automation?id=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(t('auto_delete_success'));
        setDeleteTarget(null);
        await fetchData();
      } else {
        toast.error(t('auto_delete_failed'));
      }
    } catch {
      toast.error(t('auto_delete_failed'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTestSend = async (rule: ReportAutomation) => {
    setSendingId(rule.id);
    try {
      const res = await fetch('/api/automation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_send',
          automation_id: rule.id,
          branch: rule.branch,
          recipients: rule.recipient_emails,
          cycle_start_day: rule.cycle_start_day,
          cycle_end_day: rule.cycle_end_day,
          dispatch_day: rule.dispatch_day,
          report_format: rule.report_format || 'both',
          report_type: rule.report_type || 'timecard',
          cadence: rule.cadence || 'monthly',
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || t('success'));
        await fetchData();
      } else {
        toast.error(data.error || t('auto_dispatch_failed'));
      }
    } catch {
      toast.error(t('auto_dispatch_failed'));
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="animate-in fade-in space-y-6 duration-200">
      <PageHeader
        title={t('auto_title')}
        description={t('auto_subtitle')}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void fetchData()}
              aria-label={t('refresh')}
              title={t('refresh')}
            >
              <RefreshCw size={16} />
            </Button>
            <Button icon={Plus} onClick={openCreateModal}>
              {t('auto_btn_create_rule')}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t('auto_metric_rules')}
          value={rules.length}
          icon={MailCheck}
          tone="aurora"
        />
        <MetricTile
          label={t('auto_metric_active')}
          value={rules.filter((rule) => rule.is_active).length}
          icon={CheckCircle2}
          tone="success"
        />
        <MetricTile
          label={t('auto_metric_dispatches')}
          value={logs.length}
          icon={Send}
          tone="info"
        />
        <MetricTile
          label={t('auto_metric_recipients')}
          value={recipientCount}
          icon={Users}
          tone="brand"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <Card className="sheen-top flex flex-col gap-4 p-5">
          <div>
            <h3 className="text-sm font-bold text-ink">
              {t('auto_outcome_title')}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {t('auto_outcome_desc')}
            </p>
          </div>

          {logs.length > 0 ? (
            <div className="flex flex-1 flex-wrap items-center justify-center gap-6">
              <Donut
                segments={outcomeSegments}
                size={148}
                thickness={13}
                centerLabel={String(logs.length)}
                centerSub={t('auto_metric_dispatches')}
              />
              <ChartLegend segments={outcomeSegments} className="min-w-[9rem] flex-1" />
            </div>
          ) : (
            <p className="grid flex-1 place-items-center text-xs text-ink-subtle">
              {t('auto_no_dispatches')}
            </p>
          )}
        </Card>

        <div className="grid gap-5 sm:grid-cols-2">
          <Card className="sheen-top flex items-start gap-4 p-5">
            <span className="glow-current grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-brand-line bg-brand-soft text-brand">
              <Calendar size={21} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink">{t('auto_payroll_cycle')}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {t('auto_payroll_desc')}
              </p>
            </div>
          </Card>

          <Card className="sheen-top flex items-start gap-4 p-5">
            <span className="glow-current grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-success-line bg-success-soft text-success">
              <Clock size={21} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink">
                {t('auto_dispatch_schedule')}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {t('auto_dispatch_desc')}
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Rules */}
      <TableCard>
        <CardHeader
          title={`${t('auto_rules_title')} (${rules.length})`}
          actions={
            <Badge tone={rules.length > 0 ? 'success' : 'neutral'} size="sm">
              {rules.filter((rule) => rule.is_active).length} {t('auto_active')}
            </Badge>
          }
        />
        <TableScroll>
          <Table caption={t('auto_rules_title')} className="min-w-[56rem]">
            <THead>
              <tr>
                <Th>{t('filter_branch')}</Th>
                <Th>{t('auto_payroll_cycle_col')}</Th>
                <Th>{t('auto_recipients')}</Th>
                <Th>{t('auto_format')}</Th>
                <Th>{t('auto_status')}</Th>
                <Th align="end">{t('actions')}</Th>
              </tr>
            </THead>

            <TBody>
              {isLoading && (
                <TableMessageRow colSpan={6}>
                  <TableSkeleton rows={3} columns={6} />
                </TableMessageRow>
              )}

              {!isLoading &&
                rules.map((rule, index) => {
                  const isSending = sendingId === rule.id;
                  const visibleRecipients = rule.recipient_emails.slice(0, 3);
                  const hiddenCount = rule.recipient_emails.length - 3;

                  return (
                    <Tr
                      key={rule.id}
                      className="stagger-in"
                      style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                    >
                      <Td>
                        <span className="flex items-center gap-2 font-bold text-ink">
                          <Building2
                            size={15}
                            className="text-brand"
                            aria-hidden="true"
                          />
                          {rule.branch === 'all'
                            ? t('filter_all_branches')
                            : rule.branch}
                        </span>
                      </Td>

                      <Td>
                        <p
                          className="font-mono text-xs font-semibold text-ink"
                          data-numeric
                        >
                          {t('auto_day')} {rule.cycle_start_day || 26} →{' '}
                          {t('auto_day')} {rule.cycle_end_day || 25}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone="brand" size="sm">
                            {t(REPORT_TYPE_LABEL[rule.report_type ?? 'timecard'] ?? 'report_timecard')}
                          </Badge>
                          <Badge tone="neutral" size="sm">
                            {t(CADENCE_LABEL[rule.cadence ?? 'monthly'] ?? 'cadence_monthly')}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-ink-subtle" data-numeric>
                          {t('auto_dispatch_day_prefix')}{' '}
                          {(rule.cadence ?? 'monthly') === 'weekly'
                            ? t(WEEKDAY_LABEL[rule.dispatch_day ?? 0] ?? 'weekday_sun')
                            : (rule.dispatch_day ?? 26)}{' '}
                          • {(rule.dispatch_time || '08:00:00').slice(0, 5)}
                        </p>
                      </Td>

                      <Td>
                        <div className="flex max-w-md flex-wrap gap-1.5">
                          {visibleRecipients.map((email) => (
                            <Badge key={email} tone="neutral" size="sm">
                              {email}
                            </Badge>
                          ))}
                          {hiddenCount > 0 && (
                            <Badge tone="brand" size="sm">
                              +{hiddenCount}
                            </Badge>
                          )}
                        </div>
                      </Td>

                      <Td>
                        <Badge tone="info" size="sm">
                          {t(FORMAT_LABEL[rule.report_format] ?? 'auto_format_both_short')}
                        </Badge>
                      </Td>

                      <Td>
                        <Badge
                          tone={rule.is_active ? 'success' : 'neutral'}
                          size="sm"
                          dot
                          pulse={rule.is_active}
                        >
                          {rule.is_active ? t('auto_active') : t('auto_inactive')}
                        </Badge>
                      </Td>

                      <Td align="end">
                        <div className="inline-flex items-center gap-1.5">
                          <Button
                            variant="success"
                            size="sm"
                            icon={Send}
                            loading={isSending}
                            loadingLabel={t('auto_sending')}
                            onClick={() => void handleTestSend(rule)}
                          >
                            {t('auto_btn_test_send')}
                          </Button>
                          <Button
                            variant="subtle"
                            size="sm"
                            icon={Edit}
                            onClick={() => openEditModal(rule)}
                            aria-label={`${t('edit')} — ${rule.branch}`}
                          >
                            {t('edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="iconSm"
                            onClick={() => setDeleteTarget(rule)}
                            aria-label={`${t('delete')} — ${rule.branch}`}
                            title={t('delete')}
                            className="text-ink-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}

              {!isLoading && rules.length === 0 && (
                <TableMessageRow colSpan={6}>
                  <EmptyState
                    icon={MailCheck}
                    title={t('auto_no_rules')}
                    description={t('auto_rules_empty_hint')}
                    action={{
                      label: t('auto_btn_create_rule'),
                      onClick: openCreateModal,
                    }}
                  />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableCard>

      {/* Dispatch logs */}
      <TableCard>
        <CardHeader title={t('auto_logs_title')} icon={MailCheck} />
        <TableScroll>
          <Table
            caption={t('auto_logs_title')}
            className="min-w-[48rem] text-xs"
          >
            <THead>
              <tr>
                <Th>{t('col_timestamp')}</Th>
                <Th>{t('filter_branch')}</Th>
                <Th>{t('auto_payroll_cycle_col')}</Th>
                <Th>{t('auto_recipients')}</Th>
                <Th>{t('auto_status')}</Th>
              </tr>
            </THead>

            <TBody>
              {logs.map((log, index) => (
                <Tr
                  key={log.id}
                  className="stagger-in"
                  style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                >
                  <Td numeric className="font-mono text-ink-muted">
                    {new Date(log.created_at).toLocaleString()}
                  </Td>
                  <Td className="font-bold text-ink">{log.branch}</Td>
                  <Td numeric className="font-mono text-ink-muted">
                    {log.period_start} → {log.period_end}
                  </Td>
                  <Td className="text-ink-muted">
                    {(log.recipients || []).join(', ')}
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        tone={log.status === 'SUCCESS' ? 'success' : 'danger'}
                        size="sm"
                      >
                        {log.status === 'SUCCESS' ? (
                          <CheckCircle2 size={11} aria-hidden="true" />
                        ) : (
                          <AlertCircle size={11} aria-hidden="true" />
                        )}
                        {log.status}
                      </Badge>
                      {log.error_message && (
                        <span
                          className="max-w-xs truncate text-[11px] text-danger"
                          title={log.error_message}
                        >
                          {log.error_message}
                        </span>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}

              {logs.length === 0 && (
                <TableMessageRow colSpan={5}>
                  <EmptyState
                    icon={MailCheck}
                    title={t('auto_no_logs')}
                    description={t('auto_logs_empty_hint')}
                  />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableCard>

      {/* Create / edit rule */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('auto_modal_title')}
        description={t('auto_modal_desc')}
        closeLabel={t('close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="automation-form" loading={isSaving}>
              {t('save')}
            </Button>
          </>
        }
      >
        <form id="automation-form" onSubmit={handleSaveRule} className="space-y-4">
          <Field label={t('auto_modal_branch')} required>
            <Select
              value={modalBranch}
              onChange={(event) => setModalBranch(event.target.value)}
            >
              <option value="all">{t('filter_all_branches')}</option>
              {branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('auto_report_type')}>
              <Select
                value={modalReportType}
                onChange={(event) => setModalReportType(event.target.value as ReportType)}
              >
                {(Object.keys(REPORT_TYPE_LABEL) as ReportType[]).map((type) => (
                  <option key={type} value={type}>
                    {t(REPORT_TYPE_LABEL[type])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('auto_cadence')}>
              <Select
                value={modalCadence}
                onChange={(event) => {
                  const next = event.target.value as ReportCadence;
                  setModalCadence(next);
                  // `dispatch_day` means "day of month" for monthly rules and
                  // "weekday" for weekly ones. Carrying 26 across would mean the
                  // rule never fires, so normalise it on the switch.
                  setModalDispatchDay((prev) => {
                    if (next === 'weekly') return prev > 6 ? 0 : prev;
                    return prev < 1 ? 26 : prev;
                  });
                }}
              >
                <option value="monthly">{t('cadence_monthly')}</option>
                <option value="weekly">{t('cadence_weekly')}</option>
                <option value="daily">{t('cadence_daily')}</option>
              </Select>
            </Field>
            <Field label={t('auto_dispatch_time')} required>
              <Input
                type="time"
                required
                value={modalDispatchTime}
                onChange={(event) => setModalDispatchTime(event.target.value)}
                className="text-center font-mono"
              />
            </Field>
          </div>

          <fieldset className="space-y-3 rounded-xl border border-line bg-surface-2 p-3.5">
            <legend className="px-1 text-xs font-bold text-ink">
              {modalCadence === 'monthly'
                ? t('auto_cycle_days_label')
                : modalCadence === 'weekly'
                  ? t('auto_weekly_day_label')
                  : t('auto_daily_label')}
            </legend>
            {modalCadence === 'weekly' && (
              <Field label={t('auto_weekly_day_label')} required>
                <Select
                  value={String(modalDispatchDay > 6 ? 0 : modalDispatchDay)}
                  onChange={(event) => setModalDispatchDay(Number(event.target.value))}
                >
                  {WEEKDAY_LABEL.map((key, index) => (
                    <option key={key} value={index}>
                      {t(key)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {modalCadence === 'monthly' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('auto_start_day_label')} required>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  required
                  value={modalStartDay}
                  onChange={(event) => setModalStartDay(Number(event.target.value))}
                  className="text-center font-bold"
                />
              </Field>
              <Field label={t('auto_end_day_label')} required>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  required
                  value={modalEndDay}
                  onChange={(event) => setModalEndDay(Number(event.target.value))}
                  className="text-center font-bold"
                />
              </Field>
              <Field label={t('auto_dispatch_day_label')} required>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  required
                  value={modalDispatchDay}
                  onChange={(event) => setModalDispatchDay(Number(event.target.value))}
                  className="text-center font-bold text-brand"
                />
              </Field>
            </div>
            )}
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              {modalCadence === 'monthly'
                ? t('auto_cycle_example')
                : modalCadence === 'weekly'
                  ? t('auto_weekly_hint')
                  : t('auto_daily_hint')}
            </p>
          </fieldset>

          <Field
            label={t('auto_recipients')}
            required
            hint={t('auto_modal_emails_hint')}
          >
            <Textarea
              required
              rows={3}
              value={modalEmails}
              onChange={(event) => setModalEmails(event.target.value)}
              placeholder={t('auto_modal_emails_placeholder')}
            />
          </Field>

          <Field label={t('auto_modal_format')}>
            <Select
              value={modalFormat}
              onChange={(event) =>
                setModalFormat(event.target.value as 'excel' | 'pdf' | 'both')
              }
            >
              <option value="both">{t('auto_format_both')}</option>
              <option value="excel">{t('auto_format_excel')}</option>
              <option value="pdf">{t('auto_format_pdf')}</option>
            </Select>
          </Field>

          <Switch
            checked={modalIsActive}
            onCheckedChange={setModalIsActive}
            label={t('auto_active')}
            description={t('auto_dispatch_desc')}
            className="rounded-xl border border-line bg-surface-2 p-3.5"
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteRule()}
        title={t('auto_delete_title')}
        description={t('auto_delete_desc')}
        details={
          deleteTarget && (
            <p className="text-ink-muted">
              <span className="font-semibold text-ink">
                {deleteTarget.branch === 'all'
                  ? t('filter_all_branches')
                  : deleteTarget.branch}
              </span>{' '}
              • {deleteTarget.recipient_emails.length} {t('auto_recipients')}
            </p>
          )
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        loading={isDeleting}
      />
    </div>
  );
}
