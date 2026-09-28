'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarOff,
  CalendarPlus,
  Check,
  Plane,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { MetricTile } from '@/components/ui/StatCard';
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
import type { BadgeTone } from '@/components/ui/Badge';
import type { TranslationKey } from '@/lib/i18n/translations';
import type { CSSProperties } from 'react';

interface LeaveType {
  id: string;
  name: string;
  paid: boolean;
  requires_approval: boolean;
  accrual_per_year: number;
}

interface LeaveRequest {
  id: string;
  pin: string;
  full_name: string | null;
  type_id: string;
  type_name: string | null;
  from_date: string;
  to_date: string;
  days: number;
  status: string;
  note: string | null;
}

interface Balances {
  pin: string;
  full_name: string | null;
  type_id: string;
  type_name: string;
  entitled: number;
  used: number;
  remaining: number;
}

interface Employee {
  pin: string;
  full_name: string | null;
  branch?: string | null;
}

interface Holiday {
  id: string;
  date: string;
  name: string;
  scope: string;
  is_working_day: boolean;
}

interface LeaveData {
  types: LeaveType[];
  employees: Employee[];
  requests: LeaveRequest[];
  balances: Balances[];
}

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'leave_status_pending',
  approved: 'leave_status_approved',
  rejected: 'leave_status_rejected',
  cancelled: 'leave_status_cancelled',
};

export default function LeavePage() {
  const [data, setData] = useState<LeaveData>({ types: [], employees: [], requests: [], balances: [] });
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const [form, setForm] = useState({ pin: '', type_id: '', from_date: '', to_date: '', note: '' });
  const [newType, setNewType] = useState({ name: '', accrual_per_year: '', requires_approval: true });
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '', scope: 'all', is_working_day: false });
  const [deleteType, setDeleteType] = useState<LeaveType | null>(null);

  const { t } = useLanguage();
  const toast = useToast();

  const year = new Date().getUTCFullYear();

  const load = useCallback(async () => {
    try {
      const [leaveRes, holidaysRes] = await Promise.all([
        fetch(`/api/leave/requests?year=${year}&status=${statusFilter}`),
        fetch(`/api/holidays?from=${year}-01-01&to=${year}-12-31`),
      ]);
      const leaveJson = await leaveRes.json();
      const holidaysJson = await holidaysRes.json();

      if (leaveRes.ok) {
        setData({
          types: leaveJson.types ?? [],
          employees: leaveJson.employees ?? [],
          requests: leaveJson.requests ?? [],
          balances: leaveJson.balances ?? [],
        });
        setForm((prev) => ({
          ...prev,
          pin: prev.pin || leaveJson.employees?.[0]?.pin || '',
          type_id: prev.type_id || leaveJson.types?.[0]?.id || '',
        }));
      } else {
        toast.error(leaveJson.error || t('leave_load_failed'));
      }

      if (holidaysRes.ok) setHolidays(Array.isArray(holidaysJson) ? holidaysJson : []);
    } catch {
      toast.error(t('leave_load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, t, toast, year]);

  useEffect(() => {
    // Deferred off the effect path: the loader sets state, and calling it
    // synchronously here is what react-hooks/set-state-in-effect flags.
    void Promise.resolve().then(load);
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);

  const onLeaveToday = useMemo(
    () =>
      data.requests.filter(
        (row) => row.status === 'approved' && row.from_date <= today && row.to_date >= today,
      ).length,
    [data.requests, today],
  );

  const post = async (
    url: string,
    body: unknown,
    successKey: TranslationKey,
    method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
    busyKey = url,
  ) => {
    setIsBusy(busyKey);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'DELETE' ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(t(successKey));
        await load();
        return true;
      }
      toast.error(json.error || t('leave_action_failed'));
      return false;
    } catch {
      toast.error(t('leave_action_failed'));
      return false;
    } finally {
      setIsBusy(null);
    }
  };

  const createRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await post(
      '/api/leave/requests',
      {
        pin: form.pin,
        type_id: form.type_id,
        from_date: form.from_date,
        to_date: form.to_date || form.from_date,
        note: form.note || undefined,
      },
      'leave_request_created',
      'POST',
      'create-request',
    );
    if (ok) setForm((prev) => ({ ...prev, from_date: '', to_date: '', note: '' }));
  };

  const decide = (id: string, status: 'approved' | 'rejected') =>
    post(
      '/api/leave/requests',
      { id, status },
      status === 'approved' ? 'leave_request_approved' : 'leave_request_rejected',
      'PATCH',
      `decide:${id}`,
    );

  const addType = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await post(
      '/api/leave/types',
      {
        name: newType.name,
        requires_approval: newType.requires_approval,
        accrual_per_year: newType.accrual_per_year ? Number(newType.accrual_per_year) : 0,
      },
      'leave_type_created',
      'POST',
      'create-type',
    );
    if (ok) setNewType({ name: '', accrual_per_year: '', requires_approval: true });
  };

  const addHoliday = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await post(
      '/api/holidays',
      {
        date: newHoliday.date,
        name: newHoliday.name,
        scope: newHoliday.scope,
        is_working_day: newHoliday.is_working_day,
      },
      'holiday_created',
      'POST',
      'create-holiday',
    );
    if (ok) setNewHoliday({ date: '', name: '', scope: 'all', is_working_day: false });
  };

  const balanceRows = useMemo(() => {
    const grouped = new Map<string, { name: string; types: Balances[] }>();
    data.balances.forEach((row) => {
      const key = row.pin;
      const entry = grouped.get(key) ?? { name: row.full_name || `PIN ${row.pin}`, types: [] };
      entry.types.push(row);
      grouped.set(key, entry);
    });
    return [...grouped.entries()].map(([pin, value]) => ({ pin, ...value }));
  }, [data.balances]);

  return (
    <div className="animate-in fade-in space-y-6 duration-200">
      <PageHeader
        title={t('leave_title')}
        description={t('leave_subtitle')}
        actions={
          <Button
            variant="ghost"
            icon={RefreshCw}
            loading={isBusy === 'refresh'}
            onClick={() => {
              setIsBusy('refresh');
              void load().finally(() => setIsBusy(null));
            }}
          >
            {t('refresh')}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t('leave_metric_pending')}
          value={data.requests.filter((row) => row.status === 'pending').length}
          icon={CalendarOff}
          tone="warning"
        />
        <MetricTile
          label={t('leave_metric_approved')}
          value={data.requests.filter((row) => row.status === 'approved').length}
          icon={Check}
          tone="success"
        />
        <MetricTile label={t('leave_metric_on_leave_today')} value={onLeaveToday} icon={Plane} tone="info" />
        <MetricTile label={t('leave_metric_holidays')} value={holidays.length} icon={CalendarPlus} tone="brand" />
      </div>

      {/* `[&>*]:min-w-0` so a card holding a wide table cannot widen the whole
          grid track — without it the table's min-width sets the column width and
          the page scrolls sideways instead of the table scrolling on its own. */}
      <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-3">
        {/* New request */}
        <Card className="h-fit min-w-0">
          <CardHeader title={t('leave_new_title')} icon={Plane} />
          <form onSubmit={createRequest} className="space-y-4 p-5">
            <Field label={t('leave_field_employee')} required>
              <Select value={form.pin} onChange={(e) => setForm((p) => ({ ...p, pin: e.target.value }))}>
                {data.employees.map((employee) => (
                  <option key={employee.pin} value={employee.pin}>
                    {employee.full_name || `PIN ${employee.pin}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('leave_field_type')} required>
              <Select value={form.type_id} onChange={(e) => setForm((p) => ({ ...p, type_id: e.target.value }))}>
                {data.types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('leave_field_from')} required>
                <Input
                  type="date"
                  required
                  value={form.from_date}
                  onChange={(e) => setForm((p) => ({ ...p, from_date: e.target.value }))}
                />
              </Field>
              <Field label={t('leave_field_to')}>
                <Input
                  type="date"
                  value={form.to_date}
                  onChange={(e) => setForm((p) => ({ ...p, to_date: e.target.value }))}
                />
              </Field>
            </div>
            <Field label={t('leave_field_note')}>
              <Input
                value={form.note}
                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                placeholder={t('leave_field_note_placeholder')}
              />
            </Field>
            <Button type="submit" loading={isBusy === 'create-request'} className="w-full" icon={Plus}>
              {t('leave_btn_create')}
            </Button>
          </form>
        </Card>

        {/* Requests */}
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('leave_requests_title')}
            icon={CalendarOff}
            actions={
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-40"
              >
                <option value="all">{t('leave_filter_all')}</option>
                <option value="pending">{t('leave_status_pending')}</option>
                <option value="approved">{t('leave_status_approved')}</option>
                <option value="rejected">{t('leave_status_rejected')}</option>
              </Select>
            }
          />
          <TableScroll>
            <Table caption={t('leave_requests_title')} className="min-w-[44rem]">
              <THead>
                <tr>
                  <Th>{t('col_employee')}</Th>
                  <Th>{t('leave_col_type')}</Th>
                  <Th>{t('leave_col_range')}</Th>
                  <Th align="end">{t('leave_col_days')}</Th>
                  <Th>{t('col_status')}</Th>
                  <Th align="end">{t('actions')}</Th>
                </tr>
              </THead>
              <TBody>
                {isLoading && (
                  <TableMessageRow colSpan={6}>
                    <TableSkeleton rows={5} columns={6} />
                  </TableMessageRow>
                )}

                {!isLoading &&
                  data.requests.map((row, index) => (
                    <Tr
                      key={row.id}
                      className="stagger-in"
                      style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                    >
                      <Td>
                        <p className="font-semibold text-ink">{row.full_name || `PIN ${row.pin}`}</p>
                        <p className="mt-0.5 font-mono text-[11px] text-ink-subtle">{row.pin}</p>
                      </Td>
                      <Td className="text-ink-muted">{row.type_name || '—'}</Td>
                      <Td numeric className="font-mono text-xs text-ink-muted">
                        {row.from_date} → {row.to_date}
                      </Td>
                      <Td align="end" numeric className="font-mono text-ink">
                        {row.days}
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} size="sm" dot>
                          {t(STATUS_KEY[row.status] ?? 'leave_status_pending')}
                        </Badge>
                      </Td>
                      <Td align="end">
                        {row.status === 'pending' ? (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="success"
                              size="sm"
                              icon={Check}
                              loading={isBusy === `decide:${row.id}`}
                              onClick={() => void decide(row.id, 'approved')}
                            >
                              {t('leave_btn_approve')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={X}
                              className="text-danger"
                              onClick={() => void decide(row.id, 'rejected')}
                            >
                              {t('leave_btn_reject')}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-ink-subtle">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}

                {!isLoading && data.requests.length === 0 && (
                  <TableMessageRow colSpan={6}>
                    <EmptyState icon={CalendarOff} title={t('leave_no_requests')} />
                  </TableMessageRow>
                )}
              </TBody>
            </Table>
          </TableScroll>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {/* Holidays */}
        <Card>
          <CardHeader title={t('holidays_title')} description={t('holidays_desc')} icon={CalendarPlus} />
          <form onSubmit={addHoliday} className="grid gap-3 border-b border-line p-5 sm:grid-cols-2">
            <Field label={t('holiday_date')} required>
              <Input
                type="date"
                required
                value={newHoliday.date}
                onChange={(e) => setNewHoliday((p) => ({ ...p, date: e.target.value }))}
              />
            </Field>
            <Field label={t('holiday_name')} required>
              <Input
                required
                value={newHoliday.name}
                onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
                placeholder={t('holiday_name_placeholder')}
              />
            </Field>
            <Field label={t('holiday_scope')}>
              <Select
                value={newHoliday.scope}
                onChange={(e) => setNewHoliday((p) => ({ ...p, scope: e.target.value }))}
              >
                <option value="all">{t('holiday_scope_all')}</option>
                {[...new Set(data.employees.map((e) => e.branch).filter(Boolean))].map((branch) => (
                  <option key={String(branch)} value={String(branch)}>
                    {String(branch)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('holiday_type')}>
              <Select
                value={newHoliday.is_working_day ? 'working' : 'off'}
                onChange={(e) => setNewHoliday((p) => ({ ...p, is_working_day: e.target.value === 'working' }))}
              >
                <option value="off">{t('holiday_type_off')}</option>
                <option value="working">{t('holiday_type_working')}</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={isBusy === 'create-holiday'} className="w-full" icon={Plus}>
                {t('holiday_add')}
              </Button>
            </div>
          </form>

          <div className="max-h-80 divide-y divide-line overflow-y-auto">
            {holidays.map((holiday) => (
              <div key={holiday.id} className="flex items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-line bg-brand-soft text-brand">
                  <CalendarPlus size={15} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{holiday.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-subtle">
                    {holiday.date} • {holiday.scope === 'all' ? t('holiday_scope_all') : holiday.scope}
                  </p>
                </div>
                {holiday.is_working_day && (
                  <Badge tone="info" size="sm">
                    {t('holiday_type_working')}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={t('delete')}
                  title={t('delete')}
                  className="text-ink-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  onClick={() => void post(`/api/holidays?id=${holiday.id}`, null, 'holiday_deleted', 'DELETE', `holiday:${holiday.id}`)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}

            {holidays.length === 0 && <EmptyState icon={CalendarPlus} title={t('holidays_empty')} className="py-10" />}
          </div>
        </Card>

        {/* Leave types */}
        <Card>
          <CardHeader title={t('leave_types_title')} description={t('leave_types_desc')} icon={CalendarOff} />
          <form onSubmit={addType} className="grid gap-3 border-b border-line p-5 sm:grid-cols-2">
            <Field label={t('leave_type_name')} required>
              <Input
                required
                value={newType.name}
                onChange={(e) => setNewType((p) => ({ ...p, name: e.target.value }))}
                placeholder={t('leave_type_name_placeholder')}
              />
            </Field>
            <Field label={t('leave_type_accrual')}>
              <Input
                type="number"
                min={0}
                value={newType.accrual_per_year}
                onChange={(e) => setNewType((p) => ({ ...p, accrual_per_year: e.target.value }))}
                placeholder="0"
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={isBusy === 'create-type'} className="w-full" icon={Plus}>
                {t('leave_type_add')}
              </Button>
            </div>
          </form>

          <div className="divide-y divide-line">
            {data.types.map((type) => (
              <div key={type.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{type.name}</p>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">
                    {type.requires_approval ? t('leave_type_approval') : t('leave_type_no_approval')} •{' '}
                    {Number(type.accrual_per_year) || 0} {t('leave_days_suffix')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={t('delete')}
                  title={t('delete')}
                  className="text-ink-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  onClick={() => setDeleteType(type)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Balances */}
      <TableCard>
        <CardHeader title={t('leave_balances_title')} description={t('leave_balances_desc')} icon={Plane} />
        <TableScroll>
          <Table caption={t('leave_balances_title')} className="min-w-[44rem]">
            <THead>
              <tr>
                <Th>{t('col_employee')}</Th>
                {data.types.map((type) => (
                  <Th key={type.id} align="end">
                    {type.name}
                  </Th>
                ))}
              </tr>
            </THead>
            <TBody>
              {balanceRows.map((row) => (
                <Tr key={row.pin}>
                  <Td className="font-semibold text-ink">{row.name}</Td>
                  {data.types.map((type) => {
                    const balance = row.types.find((b) => b.type_id === type.id);
                    if (!balance) return <Td key={type.id} align="end" className="text-ink-subtle">—</Td>;
                    return (
                      <Td key={type.id} align="end" numeric className="font-mono text-xs">
                        <span className={balance.remaining < 0 ? 'text-danger' : 'text-ink'}>
                          {balance.remaining}
                        </span>
                        <span className="text-ink-subtle">
                          {' '}
                          / {balance.entitled}
                        </span>
                      </Td>
                    );
                  })}
                </Tr>
              ))}
              {balanceRows.length === 0 && (
                <TableMessageRow colSpan={Math.max(1, data.types.length + 1)}>
                  <EmptyState icon={Plane} title={t('leave_no_balances')} />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableCard>

      <ConfirmDialog
        open={deleteType !== null}
        onClose={() => setDeleteType(null)}
        onConfirm={() => {
          const type = deleteType;
          setDeleteType(null);
          if (type) void post(`/api/leave/types?id=${type.id}`, null, 'leave_type_deleted', 'DELETE', `type:${type.id}`);
        }}
        title={t('leave_type_delete_title')}
        description={t('leave_type_delete_desc')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        loading={isBusy !== null && isBusy.startsWith('type:')}
      />
    </div>
  );
}
