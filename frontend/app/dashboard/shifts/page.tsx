'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Clock, Moon, Trash2, UserPlus, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/components/LanguageContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { MetricTile } from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils/cn';
import type { Employee, EmployeeShift, Shift } from '@/types';
import type { CSSProperties } from 'react';

const DAY_MINUTES = 24 * 60;

const shortTime = (value?: string | null) => value?.substring(0, 5) || '--:--';

/** "HH:MM(:SS)" → minutes past midnight. */
function toMinutes(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(':');
  const parsed = Number(hours) * 60 + Number(minutes);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Length of a shift window, handling shifts that run past midnight. */
function shiftLength(start?: string | null, end?: string | null) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null) return 0;
  return to > from ? to - from : DAY_MINUTES - from + to;
}

function durationLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * A shift window drawn across a 24-hour track. Windows that cross midnight are
 * split into a segment at each end of the day.
 */
function ShiftTrack({
  start,
  end,
  className,
}: {
  start?: string | null;
  end?: string | null;
  className?: string;
}) {
  const from = toMinutes(start);
  const to = toMinutes(end);

  if (from === null || to === null || from === to) {
    return (
      <div
        aria-hidden="true"
        className={cn('h-2.5 w-full rounded-full bg-surface-3', className)}
      />
    );
  }

  const segments =
    to > from
      ? [{ from, to }]
      : [
          { from, to: DAY_MINUTES },
          { from: 0, to },
        ];

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3',
        className,
      )}
    >
      {[25, 50, 75].map((mark) => (
        <span
          key={mark}
          className="absolute inset-y-0 w-px bg-line-strong/50"
          style={{ left: `${mark}%` }}
        />
      ))}

      {segments.map((segment) => (
        <span
          key={`${segment.from}-${segment.to}`}
          className="bar-rise aurora-bg absolute inset-y-0 rounded-full"
          style={{
            left: `${(segment.from / DAY_MINUTES) * 100}%`,
            width: `${((segment.to - segment.from) / DAY_MINUTES) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newShiftName, setNewShiftName] = useState('');
  const [newShiftStart, setNewShiftStart] = useState('09:00');
  const [newShiftEnd, setNewShiftEnd] = useState('17:00');
  const [isCreating, setIsCreating] = useState(false);

  const [assignEmpPin, setAssignEmpPin] = useState('');
  const [assignShiftId, setAssignShiftId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  const [removalTarget, setRemovalTarget] = useState<EmployeeShift | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  const supabase = useMemo(() => createClient(), []);
  const { t } = useLanguage();
  const toast = useToast();

  const fetchData = useCallback(async () => {
    try {
      const [shiftsRes, employeesRes, assignmentsRes] = await Promise.all([
        supabase.from('shifts').select('*').order('name'),
        supabase.from('employees').select('*').order('full_name'),
        supabase
          .from('employee_shifts')
          .select(
            '*, shifts(name, start_time, end_time), employees(full_name, branch, department)',
          ),
      ]);

      if (shiftsRes.error) throw shiftsRes.error;
      if (employeesRes.error) throw employeesRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      const nextShifts = shiftsRes.data || [];
      const nextEmployees = employeesRes.data || [];

      setShifts(nextShifts);
      setEmployees(nextEmployees);
      setEmployeeShifts(assignmentsRes.data || []);

      // Functional updates keep the selections without making them effect deps.
      setAssignShiftId((prev) => prev || nextShifts[0]?.id || '');
      setAssignEmpPin((prev) => prev || nextEmployees[0]?.pin || '');
    } catch {
      toast.error(t('shifts_fetch_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [supabase, t, toast]);

  useEffect(() => {
    // Deferred off the effect path: the loader sets state, and calling it
    // synchronously here is what react-hooks/set-state-in-effect flags.
    void Promise.resolve().then(fetchData);
  }, [fetchData]);

  const isOvernight = newShiftEnd < newShiftStart;

  const createShift = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsCreating(true);
    try {
      const { error } = await supabase.from('shifts').insert([
        {
          name: newShiftName,
          start_time: newShiftStart,
          end_time: newShiftEnd,
        },
      ]);

      if (error) throw error;
      toast.success(t('shifts_create_success'));
      setNewShiftName('');
      await fetchData();
    } catch {
      toast.error(t('shifts_create_failed'));
    } finally {
      setIsCreating(false);
    }
  };

  const assignShift = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!assignEmpPin || !assignShiftId) return;
    setIsAssigning(true);
    try {
      const { error } = await supabase
        .from('employee_shifts')
        .upsert(
          { pin: assignEmpPin, shift_id: assignShiftId },
          { onConflict: 'pin' },
        );

      if (error) throw error;
      toast.success(t('shifts_assign_success'));
      await fetchData();
    } catch {
      toast.error(t('shifts_assign_failed'));
    } finally {
      setIsAssigning(false);
    }
  };

  const removeShiftAssignment = async () => {
    if (!removalTarget) return;
    setIsRemoving(true);
    try {
      const { error } = await supabase
        .from('employee_shifts')
        .delete()
        .eq('pin', removalTarget.pin);

      if (error) throw error;
      toast.success(t('shifts_remove_success'));
      setRemovalTarget(null);
      await fetchData();
    } catch {
      toast.error(t('shifts_remove_failed'));
    } finally {
      setIsRemoving(false);
    }
  };

  const assignedByShift = useMemo(() => {
    const map = new Map<string, number>();
    employeeShifts.forEach((assignment) => {
      map.set(assignment.shift_id, (map.get(assignment.shift_id) || 0) + 1);
    });
    return map;
  }, [employeeShifts]);

  const overnightCount = useMemo(
    () =>
      shifts.filter(
        (shift) => shiftLength(shift.start_time, shift.end_time) > 0 &&
          shiftLength(shift.start_time, shift.end_time) < DAY_MINUTES &&
          (toMinutes(shift.end_time) ?? 0) <= (toMinutes(shift.start_time) ?? 0),
      ).length,
    [shifts],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('shifts_title')}
        description={t('shifts_subtitle')}
        actions={
          <>
            <Badge tone="brand" size="md" icon={Clock}>
              {shifts.length} {t('shifts_templates_label')}
            </Badge>
            <Badge tone="info" size="md" icon={Users}>
              {employeeShifts.length} {t('shifts_roster_title')}
            </Badge>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t('shifts_templates_label')}
          value={shifts.length}
          icon={Clock}
          tone="aurora"
        />
        <MetricTile
          label={t('shifts_metric_assigned')}
          value={employeeShifts.length}
          icon={Users}
          tone="success"
        />
        <MetricTile
          label={t('emp_count_label')}
          value={employees.length}
          icon={UserPlus}
          tone="info"
        />
        <MetricTile
          label={t('shifts_metric_overnight')}
          value={overnightCount}
          icon={Moon}
          tone="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Create shift template */}
        <Card className="h-fit">
          <CardHeader title={t('shifts_create_title')} icon={Clock} />
          <form onSubmit={createShift} className="space-y-4 p-5">
            <Field label={t('shifts_name_label')} required>
              <Input
                required
                value={newShiftName}
                onChange={(event) => setNewShiftName(event.target.value)}
                placeholder={t('shifts_name_placeholder')}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('shifts_start_label')} required>
                <Input
                  type="time"
                  required
                  value={newShiftStart}
                  onChange={(event) => setNewShiftStart(event.target.value)}
                />
              </Field>
              <Field label={t('shifts_end_label')} required>
                <Input
                  type="time"
                  required
                  value={newShiftEnd}
                  onChange={(event) => setNewShiftEnd(event.target.value)}
                />
              </Field>
            </div>

            <ShiftTrack start={newShiftStart} end={newShiftEnd} />

            {isOvernight && (
              <p className="flex items-center gap-2 rounded-xl border border-warning-line bg-warning-soft p-3 text-xs text-warning">
                <Moon size={15} className="shrink-0" aria-hidden="true" />
                {t('shifts_overnight_badge')}
              </p>
            )}

            <Button type="submit" loading={isCreating} loadingLabel={t('saving')} className="w-full">
              {t('shifts_btn_create')}
            </Button>
          </form>
        </Card>

        {/* Assign shift */}
        <Card className="h-fit">
          <CardHeader title={t('shifts_assign_title')} icon={UserPlus} />
          <form onSubmit={assignShift} className="space-y-4 p-5">
            {shifts.length === 0 || employees.length === 0 ? (
              <EmptyState
                icon={Clock}
                title={t('shifts_no_shifts')}
                className="px-2 py-6"
              />
            ) : (
              <>
                <Field label={t('shifts_select_emp')} required>
                  <Select
                    value={assignEmpPin}
                    onChange={(event) => setAssignEmpPin(event.target.value)}
                  >
                    {employees.map((employee) => (
                      <option key={employee.pin} value={employee.pin}>
                        {employee.full_name} ({employee.pin})
                        {employee.branch ? ` — ${employee.branch}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('shifts_select_shift')} required>
                  <Select
                    value={assignShiftId}
                    onChange={(event) => setAssignShiftId(event.target.value)}
                  >
                    {shifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.name} ({shortTime(shift.start_time)} –{' '}
                        {shortTime(shift.end_time)})
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="rounded-xl border border-line bg-surface-2/60 p-3">
                  <ShiftTrack
                    start={
                      shifts.find((shift) => shift.id === assignShiftId)?.start_time
                    }
                    end={shifts.find((shift) => shift.id === assignShiftId)?.end_time}
                  />
                  <p
                    className="mt-2 flex items-center justify-between text-[11px] font-medium text-ink-subtle"
                    data-numeric
                  >
                    <span>00:00</span>
                    <span>12:00</span>
                    <span>24:00</span>
                  </p>
                </div>
              </>
            )}

            <Button
              type="submit"
              loading={isAssigning}
              loadingLabel={t('saving')}
              disabled={shifts.length === 0 || employees.length === 0}
              className="w-full"
            >
              {t('shifts_btn_assign')}
            </Button>
          </form>
        </Card>

        {/* Roster */}
        <Card className="flex flex-col">
          <CardHeader
            title={t('shifts_roster_title')}
            icon={Users}
            actions={
              <Badge tone="neutral" size="sm">
                {employeeShifts.length}
              </Badge>
            }
          />
          <div className="max-h-[26rem] flex-1 divide-y divide-line overflow-y-auto">
            {isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 px-5 py-3.5">
                  <Skeleton className="h-7 w-7 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                </div>
              ))}

            {!isLoading &&
              employeeShifts.map((assignment) => {
                const name =
                  assignment.employees?.full_name || `PIN ${assignment.pin}`;

                return (
                  <div
                    key={assignment.pin}
                    className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/70"
                  >
                    <Avatar name={name} size="sm" />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-ink">
                        {name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-ink-subtle">
                        <span>PIN: {assignment.pin}</span>
                        <span className="font-medium text-brand">
                          {assignment.shifts?.name || t('unassigned')}
                        </span>
                        <span data-numeric>
                          {shortTime(assignment.shifts?.start_time)} –{' '}
                          {shortTime(assignment.shifts?.end_time)}
                        </span>
                      </p>
                    </div>

                    <Button
                      variant="ghost"
                      size="iconSm"
                      onClick={() => setRemovalTarget(assignment)}
                      aria-label={`${t('delete')} — ${name}`}
                      title={t('delete')}
                      className="text-ink-subtle hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                );
              })}

            {!isLoading && employeeShifts.length === 0 && (
              <EmptyState
                icon={Users}
                title={t('shifts_no_roster')}
                className="py-12"
              />
            )}
          </div>
        </Card>
      </div>

      {/* Coverage */}
      <Card>
        <CardHeader
          title={t('shifts_coverage_title')}
          description={t('shifts_coverage_desc')}
          icon={CalendarClock}
        />
        <div className="divide-y divide-line">
          {isLoading &&
            Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="space-y-3 px-5 py-4">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-2.5 w-full" />
              </div>
            ))}

          {!isLoading && shifts.length === 0 && (
            <EmptyState
              icon={CalendarClock}
              title={t('shifts_no_templates')}
              className="py-12"
            />
          )}

          {!isLoading &&
            shifts.map((shift, index) => {
              const minutes = shiftLength(shift.start_time, shift.end_time);

              return (
                <div
                  key={shift.id}
                  style={{ '--ui-i': Math.min(index, 10) } as CSSProperties}
                  className="stagger-in flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
                >
                  <div className="flex w-full items-center gap-3 sm:w-56 sm:shrink-0">
                    <span className="glow-current grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand-line bg-brand-soft text-brand">
                      <Clock size={16} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">
                        {shift.name}
                      </p>
                      <p className="font-mono text-[11px] text-ink-subtle" data-numeric>
                        {shortTime(shift.start_time)} – {shortTime(shift.end_time)}
                      </p>
                    </div>
                  </div>

                  <ShiftTrack
                    start={shift.start_time}
                    end={shift.end_time}
                    className="flex-1"
                  />

                  <div className="flex shrink-0 items-center gap-2 sm:w-52 sm:justify-end">
                    <Badge tone="neutral" size="sm">
                      {assignedByShift.get(shift.id) || 0} {t('shifts_assigned_count')}
                    </Badge>
                    <Badge
                      tone={minutes >= DAY_MINUTES ? 'warning' : 'brand'}
                      size="sm"
                      dot
                    >
                      <span data-numeric>{durationLabel(minutes)}</span>
                    </Badge>
                  </div>
                </div>
              );
            })}
        </div>
      </Card>

      <ConfirmDialog
        open={removalTarget !== null}
        onClose={() => setRemovalTarget(null)}
        onConfirm={() => void removeShiftAssignment()}
        title={t('shifts_remove_confirm_title')}
        description={t('shifts_remove_confirm_desc')}
        details={
          removalTarget && (
            <p className="text-ink-muted">
              <span className="font-semibold text-ink">
                {removalTarget.employees?.full_name || `PIN ${removalTarget.pin}`}
              </span>{' '}
              • {removalTarget.shifts?.name || t('unassigned')}
            </p>
          )
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        loading={isRemoving}
      />
    </div>
  );
}
