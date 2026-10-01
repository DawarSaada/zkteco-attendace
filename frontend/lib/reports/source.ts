import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyAttendanceSummary } from '@/types';
import type { AttendanceDayInput } from './engine.ts';
import { parseTimeToMinutes, wallMinutes } from '../attendance/engine.ts';
import { calculateMinutes } from '../utils/formatTime.ts';

/**
 * The one place that reads daily attendance for reporting.
 *
 * Two tables describe the same day, and neither one alone is complete:
 *
 *   - `attendance_days` — the Phase 1 engine's computed rows (status, late,
 *     overtime, absence). It is written *incrementally*: the nightly cron and
 *     every punch edit recompute only the days they touch, so it covers the days
 *     the engine has processed and nothing else.
 *   - `daily_attendance_summary` — the legacy MIN/MAX view over
 *     `attendance_logs`. It holds every day that has a punch, but none of the
 *     engine's figures.
 *
 * Reading only the engine hides history (a partial backfill shows one row for a
 * month that has 370), and reading only the legacy view loses late/overtime.
 * So every report reads both and overlays the engine on top, per (pin, date).
 *
 * PostgREST also truncates every response at the project's "Max Rows" setting
 * (1000 by default) and does it silently — the body simply stops while
 * `content-range` still reports the full count. Every read here therefore pages
 * with `range()`, ordered, until a short page comes back.
 */

export const PAGE_SIZE = 1000;

/** Stops a runaway paging loop; far above any real report range. */
export const MAX_PAGES = 200;

export interface ReportRange {
    start: string;
    end: string;
    pin?: string | null;
    branch?: string | null;
}

export interface EmployeeRef {
    pin: string;
    full_name: string | null;
    department: string | null;
    branch: string | null;
}

/** Raw `attendance_days` row as PostgREST returns it, with its shift joined. */
interface AttendanceDayRow {
    pin: string;
    work_date: string;
    shift_id: string | null;
    expected_minutes: number | null;
    worked_minutes: number | null;
    late_minutes: number | null;
    early_leave_minutes: number | null;
    overtime_minutes: number | null;
    status: string | null;
    first_in: string | null;
    last_out: string | null;
    punch_count: number | null;
    /** PostgREST types a to-one embed as an array; at runtime it is an object. */
    shifts?: ShiftTimes | ShiftTimes[] | null;
}

interface ShiftTimes {
    start_time?: string | null;
    end_time?: string | null;
}

function joinedShift(value: AttendanceDayRow['shifts']): ShiftTimes | null {
    if (!value) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
}

type RunPage<Row> = (
    from: number,
    to: number,
) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/** Read every page of one query, past the project's Max Rows cap. */
export async function fetchAllPages<Row>(run: RunPage<Row>): Promise<Row[]> {
    const rows: Row[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * PAGE_SIZE;
        const { data, error } = await run(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);

        const batch = (data ?? []) as Row[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) return rows;
    }

    throw new Error(
        `Report range returned more than ${PAGE_SIZE * MAX_PAGES} rows; narrow the dates.`,
    );
}

export function rowKey(pin: string, date: string): string {
    return `${pin}|${date}`;
}

/**
 * Collapse the legacy view's split rows for one employee and date (the two sides
 * of a night shift, or a manual punch) into a single row, so callers keep the
 * one-row-per-pin-per-date contract the reports grid relies on.
 */
export function mergeLegacyRows(rows: DailyAttendanceSummary[]): DailyAttendanceSummary[] {
    const merged = new Map<string, DailyAttendanceSummary>();

    for (const row of rows) {
        const key = rowKey(row.pin, row.punch_date);
        const existing = merged.get(key);

        if (!existing) {
            merged.set(key, { ...row });
            continue;
        }

        if (row.check_in && (!existing.check_in || new Date(row.check_in) < new Date(existing.check_in))) {
            existing.check_in = row.check_in;
        }
        if (row.check_out && (!existing.check_out || new Date(row.check_out) > new Date(existing.check_out))) {
            existing.check_out = row.check_out;
        }

        existing.total_punches = (existing.total_punches || 0) + (row.total_punches || 0);
        if (!existing.branch && row.branch) existing.branch = row.branch;
        if (!existing.device_name && row.device_name) existing.device_name = row.device_name;
        if (!existing.full_name && row.full_name) existing.full_name = row.full_name;
        if (!existing.shift_start && row.shift_start) {
            existing.shift_start = row.shift_start;
            existing.shift_end = row.shift_end;
        }
    }

    return [...merged.values()];
}

/**
 * Overlay engine rows on the legacy rows for the same (pin, date). The engine
 * wins every field it computed; the legacy view still supplies what the engine
 * does not store (the device that took the punch).
 */
export function overlayEngineRows(
    legacyRows: DailyAttendanceSummary[],
    engineRows: DailyAttendanceSummary[],
): { rows: DailyAttendanceSummary[]; engineKeys: string[]; legacyOnlyKeys: string[] } {
    const byKey = new Map<string, DailyAttendanceSummary>();
    for (const row of legacyRows) byKey.set(rowKey(row.pin, row.punch_date), row);

    const engineKeys: string[] = [];
    const legacyOnlyKeys: string[] = [];

    for (const engine of engineRows) {
        const key = rowKey(engine.pin, engine.punch_date);
        const legacy = byKey.get(key);
        engineKeys.push(key);

        byKey.set(key, {
            pin: engine.pin,
            punch_date: engine.punch_date,
            full_name: engine.full_name ?? legacy?.full_name ?? null,
            department: engine.department ?? legacy?.department ?? null,
            branch: engine.branch ?? legacy?.branch ?? null,
            device_name: engine.device_name ?? legacy?.device_name ?? null,
            check_in: engine.check_in ?? legacy?.check_in ?? null,
            check_out: engine.check_out ?? legacy?.check_out ?? null,
            total_punches: engine.total_punches || legacy?.total_punches || 0,
            shift_start: engine.shift_start ?? legacy?.shift_start ?? null,
            shift_end: engine.shift_end ?? legacy?.shift_end ?? null,
            status: engine.status ?? null,
            expected_minutes: engine.expected_minutes ?? null,
            worked_minutes: engine.worked_minutes ?? null,
            late_minutes: engine.late_minutes ?? null,
            early_leave_minutes: engine.early_leave_minutes ?? null,
            overtime_minutes: engine.overtime_minutes ?? null,
            shift_id: engine.shift_id ?? null,
        });
    }

    for (const key of byKey.keys()) {
        if (!engineKeys.includes(key)) legacyOnlyKeys.push(key);
    }

    return { rows: [...byKey.values()], engineKeys, legacyOnlyKeys };
}

/** `YYYY-MM-DD`, then PIN with numeric awareness — the reports grid's order. */
export function sortRows(rows: DailyAttendanceSummary[]): DailyAttendanceSummary[] {
    return [...rows].sort((a, b) => {
        if (a.punch_date !== b.punch_date) return a.punch_date.localeCompare(b.punch_date);
        return a.pin.localeCompare(b.pin, undefined, { numeric: true });
    });
}

/** Minutes between two `HH:MM[:SS]` shift times, crossing midnight if needed. */
export function shiftMinutes(start?: string | null, end?: string | null): number {
    if (!start || !end) return 0;
    const from = parseTimeToMinutes(start);
    let to = parseTimeToMinutes(end);
    if (to <= from) to += 24 * 60;
    return to - from;
}

export interface RawReportData {
    engineRows: DailyAttendanceSummary[];
    legacyRows: DailyAttendanceSummary[];
    employees: EmployeeRef[];
}

function mapEngineRow(row: AttendanceDayRow, employee?: EmployeeRef): DailyAttendanceSummary {
    const shift = joinedShift(row.shifts);

    return {
        pin: row.pin,
        full_name: employee?.full_name ?? null,
        department: employee?.department ?? null,
        branch: employee?.branch ?? null,
        device_name: null,
        punch_date: row.work_date,
        check_in: row.first_in,
        check_out: row.last_out,
        total_punches: row.punch_count ?? 0,
        shift_start: shift?.start_time ?? null,
        shift_end: shift?.end_time ?? null,
        status: (row.status ?? null) as DailyAttendanceSummary['status'],
        expected_minutes: row.expected_minutes ?? 0,
        worked_minutes: row.worked_minutes ?? 0,
        late_minutes: row.late_minutes ?? 0,
        early_leave_minutes: row.early_leave_minutes ?? 0,
        overtime_minutes: row.overtime_minutes ?? 0,
        shift_id: row.shift_id ?? null,
    };
}

/**
 * Fetch both sources for one range. Linear in the row count via `fetchAllPages`,
 * and every query is ordered so paging cannot skip or repeat a row.
 */
export async function loadRawReportData(
    supabase: SupabaseClient,
    range: ReportRange,
): Promise<RawReportData> {
    const { start, end, pin, branch } = range;
    const scopedPin = pin && pin !== 'all' ? pin : null;
    const scopedBranch = branch && branch !== 'all' ? branch : null;

    const employeesPromise = fetchAllPages<EmployeeRef>((from, to) =>
        supabase
            .from('employees')
            .select('pin, full_name, department, branch')
            .order('pin', { ascending: true })
            .range(from, to),
    );

    const enginePromise = fetchAllPages<AttendanceDayRow>((from, to) => {
        let query = supabase
            .from('attendance_days')
            .select(
                'pin, work_date, shift_id, expected_minutes, worked_minutes, late_minutes, early_leave_minutes, overtime_minutes, status, first_in, last_out, punch_count, shifts(name, start_time, end_time)',
            )
            .gte('work_date', start)
            .lte('work_date', end)
            .order('work_date', { ascending: true })
            .order('pin', { ascending: true });

        if (scopedPin) query = query.eq('pin', scopedPin);
        return query.range(from, to);
    });

    const legacyPromise = fetchAllPages<DailyAttendanceSummary>((from, to) => {
        let query = supabase
            .from('daily_attendance_summary')
            .select('*')
            .gte('punch_date', start)
            .lte('punch_date', end)
            .order('punch_date', { ascending: true })
            .order('pin', { ascending: true });

        if (scopedPin) query = query.eq('pin', scopedPin);
        if (scopedBranch) query = query.eq('branch', scopedBranch);
        return query.range(from, to);
    });

    const [employees, engineRaw, legacyRaw] = await Promise.all([
        employeesPromise,
        enginePromise,
        legacyPromise,
    ]);

    const employeeByPin = new Map(employees.map((employee) => [employee.pin, employee]));

    const engineRows = engineRaw
        .filter((row) => !scopedBranch || employeeByPin.get(row.pin)?.branch === scopedBranch)
        .map((row) => mapEngineRow(row, employeeByPin.get(row.pin)));

    return { engineRows, legacyRows: mergeLegacyRows(legacyRaw), employees };
}

export interface DailyReportRows {
    rows: DailyAttendanceSummary[];
    /** Rows whose figures come from the engine. */
    engineRows: number;
    /** Rows only the legacy view could supply — days the engine has not computed. */
    legacyOnlyRows: number;
}

/** The reports grid / export shape: every (pin, date) in the range, merged. */
export async function loadDailyReportRows(
    supabase: SupabaseClient,
    range: ReportRange,
): Promise<DailyReportRows> {
    const { engineRows, legacyRows } = await loadRawReportData(supabase, range);
    const overlay = overlayEngineRows(legacyRows, engineRows);

    return {
        rows: sortRows(overlay.rows),
        engineRows: overlay.engineKeys.length,
        legacyOnlyRows: overlay.legacyOnlyKeys.length,
    };
}

/**
 * Older history predates the engine and has no stored figures, so they are
 * derived from the little the legacy view does carry: the scheduled shift window
 * and the first/last punch. When an employee has no shift assigned there is
 * nothing to compare a punch against, so lateness and overtime stay 0 rather
 * than inventing a number — the same answer the engine gives for a shiftless day.
 */
export function legacyRowToDay(row: DailyAttendanceSummary): AttendanceDayInput {
    const worked = calculateMinutes(row.check_in, row.check_out);
    const expected = shiftMinutes(row.shift_start, row.shift_end);
    const late =
        row.check_in && row.shift_start
            ? Math.max(0, wallMinutes(row.check_in) - parseTimeToMinutes(row.shift_start))
            : 0;
    const punches = row.total_punches ?? 0;

    const status: AttendanceDayInput['status'] =
        punches < 2 ? 'incomplete' : late > 0 ? 'late' : 'present';

    return {
        pin: row.pin,
        work_date: row.punch_date,
        status,
        expected_minutes: expected,
        worked_minutes: worked,
        late_minutes: late,
        early_leave_minutes: 0,
        overtime_minutes: expected > 0 && worked > expected ? worked - expected : 0,
        punch_count: punches,
        first_in: row.check_in ?? null,
        last_out: row.check_out ?? null,
        shift_id: row.shift_id ?? null,
    };
}

export interface ReportDays {
    days: AttendanceDayInput[];
    /** Days whose figures come from the engine. */
    engineDays: number;
    /** Days derived from the legacy view because the engine has not computed them. */
    derivedDays: number;
}

/**
 * The report-pack / self-service shape: the same merged rows, expressed as the
 * engine's day input so `buildReport()` and `summariseDays()` can consume them.
 */
export async function loadReportDays(
    supabase: SupabaseClient,
    range: ReportRange,
): Promise<ReportDays> {
    const { engineRows, legacyRows } = await loadRawReportData(supabase, range);
    const overlay = overlayEngineRows(legacyRows, engineRows);
    const engineKeys = new Set(overlay.engineKeys);

    const days = sortRows(overlay.rows).map((row) =>
        engineKeys.has(rowKey(row.pin, row.punch_date))
            ? {
                  pin: row.pin,
                  work_date: row.punch_date,
                  status: row.status ?? 'present',
                  expected_minutes: row.expected_minutes ?? 0,
                  worked_minutes: row.worked_minutes ?? 0,
                  late_minutes: row.late_minutes ?? 0,
                  early_leave_minutes: row.early_leave_minutes ?? 0,
                  overtime_minutes: row.overtime_minutes ?? 0,
                  punch_count: row.total_punches,
                  first_in: row.check_in ?? null,
                  last_out: row.check_out ?? null,
                  shift_id: row.shift_id ?? null,
              }
            : legacyRowToDay(row),
    );

    return {
        days,
        engineDays: overlay.engineKeys.length,
        derivedDays: overlay.legacyOnlyKeys.length,
    };
}
