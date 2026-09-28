import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { DailyAttendanceSummary } from '@/types';

interface QueryFilters {
    start: string;
    end: string;
    pin: string | null;
    branch: string | null;
}

/**
 * Preferred source: the Phase 1 engine (`attendance_days`).
 * Returns `null` when the table is missing (migration not applied yet) or has
 * no rows for the range, so the caller can fall back to the legacy view.
 */
async function fetchComputed(
    supabase: ReturnType<typeof createAdminClient>,
    { start, end, pin, branch }: QueryFilters,
): Promise<DailyAttendanceSummary[] | null> {
    let query = supabase
        .from('attendance_days')
        .select(
            'pin, work_date, shift_id, expected_minutes, worked_minutes, late_minutes, early_leave_minutes, overtime_minutes, status, first_in, last_out, punch_count, shifts(name, start_time, end_time)',
        )
        .gte('work_date', start)
        .lte('work_date', end)
        .order('work_date', { ascending: true })
        .order('pin', { ascending: true });

    if (pin && pin !== 'all') query = query.eq('pin', pin);

    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;

    const { data: employees } = await supabase
        .from('employees')
        .select('pin, full_name, department, branch');

    const employeeMap = new Map<
        string,
        { full_name: string | null; department: string | null; branch: string | null }
    >();
    ((employees ?? []) as {
        pin: string;
        full_name: string | null;
        department: string | null;
        branch: string | null;
    }[]).forEach((employee) => {
        employeeMap.set(employee.pin, {
            full_name: employee.full_name,
            department: employee.department,
            branch: employee.branch,
        });
    });

    const rows: DailyAttendanceSummary[] = [];
    for (const raw of data as unknown[]) {
        const row = raw as {
            pin: string;
            work_date: string;
            shift_id: string | null;
            expected_minutes: number;
            worked_minutes: number;
            late_minutes: number;
            early_leave_minutes: number;
            overtime_minutes: number;
            status: DailyAttendanceSummary['status'];
            first_in: string | null;
            last_out: string | null;
            punch_count: number;
            shifts?: { start_time?: string | null; end_time?: string | null } | null;
        };

        const employee = employeeMap.get(row.pin);

        if (branch && branch !== 'all' && (employee?.branch ?? null) !== branch) continue;

        rows.push({
            pin: row.pin,
            full_name: employee?.full_name ?? null,
            department: employee?.department ?? null,
            branch: employee?.branch ?? null,
            device_name: null,
            punch_date: row.work_date,
            check_in: row.first_in,
            check_out: row.last_out,
            total_punches: row.punch_count,
            shift_start: row.shifts?.start_time ?? null,
            shift_end: row.shifts?.end_time ?? null,
            status: row.status ?? null,
            expected_minutes: row.expected_minutes,
            worked_minutes: row.worked_minutes,
            late_minutes: row.late_minutes,
            early_leave_minutes: row.early_leave_minutes,
            overtime_minutes: row.overtime_minutes,
            shift_id: row.shift_id,
        });
    }

    return rows;
}

/**
 * Legacy source: the MIN/MAX `daily_attendance_summary` view. Used only while
 * `attendance_days` is empty (i.e. before the backfill has run), so deploying
 * Phase 1 never blanks an existing report.
 */
async function fetchLegacy(
    supabase: ReturnType<typeof createAdminClient>,
    { start, end, pin, branch }: QueryFilters,
): Promise<DailyAttendanceSummary[]> {
    let query = supabase
        .from('daily_attendance_summary')
        .select('*')
        .gte('punch_date', start)
        .lte('punch_date', end)
        .order('punch_date', { ascending: true })
        .order('pin', { ascending: true });

    if (pin && pin !== 'all') query = query.eq('pin', pin);
    if (branch && branch !== 'all') query = query.eq('branch', branch);

    const { data, error } = await query;
    if (error) throw error;

    // Merge any split rows for the same employee on the same date (e.g. from the
    // two sides of a night shift, or a manual punch), so the response keeps the
    // one-row-per-employee-per-date contract the UI relies on.
    const mergedMap = new Map<string, DailyAttendanceSummary>();

    ((data || []) as DailyAttendanceSummary[]).forEach((row) => {
        const key = `${row.pin}_${row.punch_date}`;
        if (!mergedMap.has(key)) {
            mergedMap.set(key, { ...row });
        } else {
            const existing = mergedMap.get(key)!;

            if (row.check_in) {
                if (!existing.check_in || new Date(row.check_in) < new Date(existing.check_in)) {
                    existing.check_in = row.check_in;
                }
            }

            if (row.check_out) {
                if (!existing.check_out || new Date(row.check_out) > new Date(existing.check_out)) {
                    existing.check_out = row.check_out;
                }
            }

            existing.total_punches = (existing.total_punches || 1) + (row.total_punches || 1);
            if (!existing.branch && row.branch) existing.branch = row.branch;
            if (!existing.device_name && row.device_name) existing.device_name = row.device_name;
            if (!existing.full_name && row.full_name) existing.full_name = row.full_name;
            if (!existing.shift_start && row.shift_start) {
                existing.shift_start = row.shift_start;
                existing.shift_end = row.shift_end;
            }
        }
    });

    return Array.from(mergedMap.values()).sort((a, b) => {
        if (a.punch_date !== b.punch_date) return a.punch_date.localeCompare(b.punch_date);
        return a.pin.localeCompare(b.pin, undefined, { numeric: true });
    });
}

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const start = searchParams.get('start');
        const end = searchParams.get('end');
        const pin = searchParams.get('pin');
        const branch = searchParams.get('branch');

        if (!start || !end) {
            return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
        }

        const filters: QueryFilters = { start, end, pin, branch };

        const computed = await fetchComputed(supabase, filters);
        if (computed) return NextResponse.json(computed);

        return NextResponse.json(await fetchLegacy(supabase, filters));
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
