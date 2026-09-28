import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_POLICY,
  addDays,
  evaluateDay,
  resolveWorkDate,
  toDateKey,
  type AttendancePolicy,
  type EvaluatedDay,
  type ExpectedShift,
  type HolidayInfo,
  type LeaveInfo,
  type ShiftPeriod,
} from './engine';

/**
 * Recompute pipeline — the only place the attendance engine touches the database.
 *
 * Every loader degrades gracefully when a migration has not been applied yet
 * (missing table ⇒ query error ⇒ fall back to legacy columns or an empty set),
 * so the code is safe to deploy before the SQL is run.
 */

export interface RecomputeResult {
  employees: number;
  days: number;
  from: string;
  to: string;
}

export interface RecomputeOptions {
  from: string;
  to: string;
  pins?: string[];
}

export interface PunchRef {
  pin: string;
  timestamp: string;
}

interface AssignmentRow {
  pin: string;
  shift_id: string;
  effective_from: string;
  effective_to: string | null;
}

interface ShiftRow {
  id: string;
  name: string | null;
  start_time: string;
  end_time: string;
  shift_periods?: {
    seq: number;
    start_time: string;
    end_time: string;
    day_offset: number;
  }[];
}

interface PolicyRow {
  id: string;
  grace_in_minutes: number;
  grace_out_minutes: number;
  min_minutes_for_full_day: number;
  weekend_days: number[];
  overtime_after_minutes: number;
  requires_overtime_approval: boolean;
}

interface HolidayRow {
  date: string;
  name: string | null;
  scope: string;
  is_working_day: boolean;
}

interface LeaveRow {
  pin: string;
  from_date: string;
  to_date: string;
  leave_types?: { name?: string | null } | null;
}

interface PunchRecord {
  timestamp: string;
  status: string;
}

interface EmployeeRow {
  pin: string;
  branch: string | null;
}

interface AttendanceDayRow {
  pin: string;
  work_date: string;
  shift_id: string | null;
  policy_id: string | null;
  expected_minutes: number;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  status: string;
  first_in: string | null;
  last_out: string | null;
  punch_count: number;
  computed_at: string;
}

const UPSERT_CHUNK = 500;

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function loadPolicy(supabase: SupabaseClient): Promise<AttendancePolicy> {
  const { data, error } = await supabase
    .from('attendance_policies')
    .select('*')
    .eq('is_default', true)
    .limit(1);

  if (error || !data || data.length === 0) return DEFAULT_POLICY;

  const row = data[0] as PolicyRow;
  return {
    id: row.id,
    name: 'Default',
    graceInMinutes: row.grace_in_minutes ?? 0,
    graceOutMinutes: row.grace_out_minutes ?? 0,
    minMinutesForFullDay: row.min_minutes_for_full_day ?? 480,
    weekendDays: Array.isArray(row.weekend_days) ? row.weekend_days : DEFAULT_POLICY.weekendDays,
    overtimeAfterMinutes: row.overtime_after_minutes ?? 0,
    requiresOvertimeApproval: !!row.requires_overtime_approval,
  };
}

async function loadShifts(supabase: SupabaseClient): Promise<Map<string, ExpectedShift>> {
  const shifts = new Map<string, ExpectedShift>();
  let rows: ShiftRow[] = [];

  const withPeriods = await supabase
    .from('shifts')
    .select('id, name, start_time, end_time, shift_periods(seq, start_time, end_time, day_offset)');

  if (withPeriods.error) {
    const fallback = await supabase.from('shifts').select('id, name, start_time, end_time');
    rows = (fallback.data ?? []) as ShiftRow[];
  } else {
    rows = (withPeriods.data ?? []) as ShiftRow[];
  }

  for (const row of rows) {
    const periods: ShiftPeriod[] = (row.shift_periods ?? [])
      .map((p) => ({
        seq: p.seq,
        startTime: p.start_time,
        endTime: p.end_time,
        dayOffset: p.day_offset ?? 0,
      }))
      .sort((a, b) => a.seq - b.seq);

    if (periods.length === 0) {
      periods.push({ seq: 1, startTime: row.start_time, endTime: row.end_time, dayOffset: 0 });
    }

    shifts.set(row.id, { shiftId: row.id, name: row.name, periods });
  }

  return shifts;
}

async function loadAssignments(
  supabase: SupabaseClient,
): Promise<Map<string, AssignmentRow[]>> {
  const map = new Map<string, AssignmentRow[]>();

  const primary = await supabase
    .from('employee_shift_assignments')
    .select('pin, shift_id, effective_from, effective_to');

  let rows = (primary.data ?? []) as AssignmentRow[];

  if (primary.error) {
    const legacy = await supabase.from('employee_shifts').select('pin, shift_id');
    rows = ((legacy.data ?? []) as { pin: string; shift_id: string }[]).map((r) => ({
      pin: r.pin,
      shift_id: r.shift_id,
      effective_from: '2000-01-01',
      effective_to: null,
    }));
  }

  for (const row of rows) {
    const list = map.get(row.pin);
    if (list) list.push(row);
    else map.set(row.pin, [row]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  }

  return map;
}

/** The assignment in force for `pin` on `date`, if any. */
export function resolveShift(
  pin: string,
  date: string,
  assignments: Map<string, AssignmentRow[]>,
  shifts: Map<string, ExpectedShift>,
): ExpectedShift | null {
  const list = assignments.get(pin);
  if (!list) return null;

  let found: AssignmentRow | null = null;
  for (const a of list) {
    if (a.effective_from <= date && (!a.effective_to || a.effective_to >= date)) {
      if (!found || a.effective_from > found.effective_from) found = a;
    }
  }
  return found ? shifts.get(found.shift_id) ?? null : null;
}

async function loadHolidays(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<Map<string, HolidayInfo>> {
  const map = new Map<string, HolidayInfo>();
  const { data, error } = await supabase
    .from('holidays')
    .select('date, name, scope, is_working_day')
    .gte('date', from)
    .lte('date', to);

  if (error || !data) return map;

  for (const row of data as HolidayRow[]) {
    map.set(`${row.date}|${row.scope}`, {
      date: row.date,
      name: row.name,
      scope: row.scope,
      isWorkingDay: !!row.is_working_day,
    });
  }
  return map;
}

function holidayFor(
  holidays: Map<string, HolidayInfo>,
  date: string,
  branch: string | null,
): HolidayInfo | null {
  if (branch) {
    const scoped = holidays.get(`${date}|${branch}`);
    if (scoped) return scoped;
  }
  return holidays.get(`${date}|all`) ?? null;
}

/** Approved leave only — a pending request must never excuse an absence. */
async function loadLeave(
  supabase: SupabaseClient,
  pins: string[],
  from: string,
  to: string,
): Promise<Map<string, LeaveRow[]>> {
  const map = new Map<string, LeaveRow[]>();
  if (pins.length === 0) return map;

  const { data, error } = await supabase
    .from('leave_requests')
    .select('pin, from_date, to_date, leave_types(name)')
    .eq('status', 'approved')
    .in('pin', pins)
    .lte('from_date', to)
    .gte('to_date', from);

  if (error || !data) return map;

  for (const row of data as LeaveRow[]) {
    const list = map.get(row.pin);
    if (list) list.push(row);
    else map.set(row.pin, [row]);
  }
  return map;
}

function leaveFor(leave: Map<string, LeaveRow[]>, pin: string, date: string): LeaveInfo | null {
  const list = leave.get(pin);
  if (!list) return null;
  const match = list.find((row) => row.from_date <= date && row.to_date >= date);
  if (!match) return null;
  return { isOnLeave: true, type: match.leave_types?.name ?? null };
}

async function loadEmployees(
  supabase: SupabaseClient,
  pins?: string[],
): Promise<EmployeeRow[]> {
  let query = supabase.from('employees').select('pin, branch');
  if (pins && pins.length > 0) query = query.in('pin', pins);
  const { data, error } = await query;
  if (error || !data) return [];
  return data as EmployeeRow[];
}

async function loadPunches(
  supabase: SupabaseClient,
  pins: string[],
  from: string,
  to: string,
): Promise<Map<string, PunchRecord[]>> {
  const map = new Map<string, PunchRecord[]>();
  if (pins.length === 0) return map;

  const { data, error } = await supabase
    .from('attendance_logs')
    .select('pin, timestamp, status')
    .in('pin', pins)
    .gte('timestamp', `${from}T00:00:00.000Z`)
    .lte('timestamp', `${to}T23:59:59.999Z`)
    .order('timestamp', { ascending: true });

  if (error || !data) return map;

  for (const row of data as { pin: string; timestamp: string; status: string | null }[]) {
    const record: PunchRecord = { timestamp: row.timestamp, status: String(row.status ?? '0') };
    const list = map.get(row.pin);
    if (list) list.push(record);
    else map.set(row.pin, [record]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Bucketing + row building
// ---------------------------------------------------------------------------

/**
 * Bucket one employee's punches into work dates. The shift used to resolve a
 * punch is the assignment on the punch's own calendar date, falling back to the
 * previous day so the after-midnight half of a night shift resolves correctly.
 */
function bucketPunches(
  pin: string,
  punches: PunchRecord[],
  assignments: Map<string, AssignmentRow[]>,
  shifts: Map<string, ExpectedShift>,
): Map<string, PunchRecord[]> {
  const groups = new Map<string, PunchRecord[]>();

  for (const punch of punches) {
    const ownDate = toDateKey(punch.timestamp);
    const shift =
      resolveShift(pin, ownDate, assignments, shifts) ??
      resolveShift(pin, addDays(ownDate, -1), assignments, shifts);

    const { workDate } = resolveWorkDate(punch.timestamp, shift?.periods ?? []);
    const bucket = groups.get(workDate);
    if (bucket) bucket.push(punch);
    else groups.set(workDate, [punch]);
  }

  for (const bucket of groups.values()) {
    bucket.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }
  return groups;
}

function toRow(pin: string, evaluated: EvaluatedDay): AttendanceDayRow {
  return {
    pin,
    work_date: evaluated.workDate,
    shift_id: evaluated.shiftId,
    policy_id: evaluated.policyId,
    expected_minutes: evaluated.expectedMinutes,
    worked_minutes: evaluated.workedMinutes,
    late_minutes: evaluated.lateMinutes,
    early_leave_minutes: evaluated.earlyLeaveMinutes,
    overtime_minutes: evaluated.overtimeMinutes,
    status: evaluated.status,
    first_in: evaluated.firstIn,
    last_out: evaluated.lastOut,
    punch_count: evaluated.punchCount,
    computed_at: new Date().toISOString(),
  };
}

async function upsertRows(supabase: SupabaseClient, rows: AttendanceDayRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from('attendance_days')
      .upsert(chunk, { onConflict: 'pin,work_date' });
    if (error) {
      console.error('[Attendance] Failed to write attendance_days:', error.message);
      throw error;
    }
  }
}

/** What the engine knows about one evaluated day, for exception bookkeeping. */
interface EvaluatedEntry {
  pin: string;
  workDate: string;
  day: EvaluatedDay;
  /** The status of the day's single punch, when there is exactly one. */
  singlePunchStatus: string | null;
}

/**
 * Keep the exception inbox in step with the engine:
 *  - an incomplete day (exactly one punch) opens a `missing_check_out` or
 *    `missing_check_in` exception, depending on which punch is present;
 *  - a day that is no longer incomplete auto-resolves any open such exception.
 *
 * An existing exception is never reopened — a clerk who resolved a day keeps
 * their decision even if the engine recomputes it.
 */
async function syncExceptions(
  supabase: SupabaseClient,
  entries: EvaluatedEntry[],
  pins: string[],
  from: string,
  to: string,
): Promise<void> {
  const desiredOpen = new Map<string, { pin: string; work_date: string; kind: string }>();

  for (const entry of entries) {
    if (entry.day.status !== 'incomplete' || entry.day.punchCount !== 1) continue;
    // status '0' is a check-in, so the missing punch is the check-out.
    const kind = entry.singlePunchStatus === '1' ? 'missing_check_in' : 'missing_check_out';
    desiredOpen.set(`${entry.pin}|${entry.workDate}|${kind}`, {
      pin: entry.pin,
      work_date: entry.workDate,
      kind,
    });
  }

  if (desiredOpen.size > 0) {
    const { error } = await supabase
      .from('exceptions')
      .upsert([...desiredOpen.values()], {
        onConflict: 'pin,work_date,kind',
        // Never overwrite: a resolved exception stays resolved.
        ignoreDuplicates: true,
      });
    if (error) console.error('[Attendance] Exception upsert failed:', error.message);
  }

  if (pins.length === 0) return;

  const { data, error } = await supabase
    .from('exceptions')
    .select('id, pin, work_date, kind')
    .eq('state', 'open')
    .in('kind', ['missing_check_out', 'missing_check_in'])
    .in('pin', pins)
    .gte('work_date', from)
    .lte('work_date', to);

  if (error || !data) return;

  const stale = (data as { id: string; pin: string; work_date: string; kind: string }[])
    .filter((row) => !desiredOpen.has(`${row.pin}|${row.work_date}|${row.kind}`))
    .map((row) => row.id);

  if (stale.length > 0) {
    const { error: resolveError } = await supabase
      .from('exceptions')
      .update({
        state: 'resolved',
        resolved_at: new Date().toISOString(),
        reason_code: 'auto',
        note: 'Auto-resolved: the day now has complete punches.',
      })
      .in('id', stale);
    if (resolveError) console.error('[Attendance] Exception auto-resolve failed:', resolveError.message);
  }
}

// ---------------------------------------------------------------------------
// Shared computation
// ---------------------------------------------------------------------------

interface ComputeContext {
  policy: AttendancePolicy;
  shifts: Map<string, ExpectedShift>;
  assignments: Map<string, AssignmentRow[]>;
  holidays: Map<string, HolidayInfo>;
  leave: Map<string, LeaveRow[]>;
  punches: Map<string, PunchRecord[]>;
}

async function buildEntry(
  pin: string,
  workDate: string,
  context: ComputeContext,
  buckets: Map<string, PunchRecord[]>,
  branch: string | null,
): Promise<EvaluatedEntry | null> {
  const shift = resolveShift(pin, workDate, context.assignments, context.shifts);
  const dayPunches = buckets.get(workDate) ?? [];
  if (!shift && dayPunches.length === 0) return null;

  const day = evaluateDay({
    workDate,
    punches: dayPunches.map((punch) => punch.timestamp),
    shift,
    policy: context.policy,
    holiday: holidayFor(context.holidays, workDate, branch),
    leave: leaveFor(context.leave, pin, workDate),
  });

  return {
    pin,
    workDate,
    day,
    singlePunchStatus: dayPunches.length === 1 ? dayPunches[0].status : null,
  };
}

async function loadContext(
  supabase: SupabaseClient,
  pins: string[],
  from: string,
  to: string,
): Promise<{ context: ComputeContext; employees: EmployeeRow[] }> {
  const [policy, shifts, assignments, employees, holidays, leave, punches] = await Promise.all([
    loadPolicy(supabase),
    loadShifts(supabase),
    loadAssignments(supabase),
    loadEmployees(supabase, pins),
    loadHolidays(supabase, from, to),
    loadLeave(supabase, pins.length ? pins : ['__none__'], from, to),
    loadPunches(supabase, pins, addDays(from, -1), addDays(to, 1)),
  ]);

  return {
    context: { policy, shifts, assignments, holidays, leave, punches },
    employees,
  };
}

async function persist(
  supabase: SupabaseClient,
  entries: EvaluatedEntry[],
  pins: string[],
  from: string,
  to: string,
): Promise<void> {
  await upsertRows(supabase, entries.map((entry) => toRow(entry.pin, entry.day)));
  await syncExceptions(supabase, entries, pins, from, to);
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Recompute an explicit set of (pin, work_date) keys. */
export async function recomputeKeys(
  supabase: SupabaseClient,
  keys: { pin: string; workDate: string }[],
): Promise<RecomputeResult> {
  const unique = new Map<string, { pin: string; workDate: string }>();
  for (const key of keys) unique.set(`${key.pin}|${key.workDate}`, key);
  if (unique.size === 0) return { employees: 0, days: 0, from: '', to: '' };

  const pins = [...new Set([...unique.values()].map((k) => k.pin))];
  const dates = [...unique.values()].map((k) => k.workDate).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];

  const { context, employees } = await loadContext(supabase, pins, from, to);
  const branchByPin = new Map(employees.map((e) => [e.pin, e.branch]));
  const bucketsByPin = new Map<string, Map<string, PunchRecord[]>>();
  for (const pin of pins) {
    bucketsByPin.set(pin, bucketPunches(pin, context.punches.get(pin) ?? [], context.assignments, context.shifts));
  }

  const entries: EvaluatedEntry[] = [];
  for (const { pin, workDate } of unique.values()) {
    const entry = await buildEntry(
      pin,
      workDate,
      context,
      bucketsByPin.get(pin) ?? new Map(),
      branchByPin.get(pin) ?? null,
    );
    if (entry) entries.push(entry);
  }

  await persist(supabase, entries, pins, from, to);
  return { employees: pins.length, days: entries.length, from, to };
}

/**
 * Recompute a date range for every employee (optionally scoped to some PINs).
 * This is the backfill entry point: pass a whole month for a full history.
 */
export async function recomputeRange(
  supabase: SupabaseClient,
  options: RecomputeOptions,
): Promise<RecomputeResult> {
  const { from, to } = options;
  const employees = await loadEmployees(supabase, options.pins);
  const pins = employees.map((e) => e.pin);
  if (pins.length === 0) return { employees: 0, days: 0, from, to };

  const { context } = await loadContext(supabase, pins, from, to);
  const branchByPin = new Map(employees.map((e) => [e.pin, e.branch]));

  const entries: EvaluatedEntry[] = [];
  for (const pin of pins) {
    const buckets = bucketPunches(pin, context.punches.get(pin) ?? [], context.assignments, context.shifts);
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const entry = await buildEntry(pin, date, context, buckets, branchByPin.get(pin) ?? null);
      if (entry) entries.push(entry);
    }
  }

  await persist(supabase, entries, pins, from, to);
  return { employees: pins.length, days: entries.length, from, to };
}

/**
 * Recompute only the (pin, work_date) pairs a batch of punches can affect.
 * Called on device ingest and on manual punch edits so the summary follows.
 */
export async function recomputeForPunches(
  supabase: SupabaseClient,
  punches: PunchRef[],
): Promise<RecomputeResult> {
  if (punches.length === 0) return { employees: 0, days: 0, from: '', to: '' };

  const [shifts, assignments] = await Promise.all([
    loadShifts(supabase),
    loadAssignments(supabase),
  ]);

  const keys: { pin: string; workDate: string }[] = [];
  for (const punch of punches) {
    const ownDate = toDateKey(punch.timestamp);
    const shift =
      resolveShift(punch.pin, ownDate, assignments, shifts) ??
      resolveShift(punch.pin, addDays(ownDate, -1), assignments, shifts);
    const { workDate } = resolveWorkDate(punch.timestamp, shift?.periods ?? []);
    keys.push({ pin: punch.pin, workDate });
  }

  return recomputeKeys(supabase, keys);
}
