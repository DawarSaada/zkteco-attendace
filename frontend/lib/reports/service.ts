import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, diffDays } from '@/lib/attendance/engine';
import {
  MAX_RANGE_DAYS,
  buildReport,
  type AttendanceDayInput,
  type EmployeeInput,
  type ReportResult,
  type ReportType,
} from './engine';

const REPORT_TYPE_VALUES: ReportType[] = [
  'timecard',
  'exceptions',
  'absence',
  'overtime',
  'rollup',
  'late',
];

export function isReportType(value: string | null | undefined): value is ReportType {
  return !!value && (REPORT_TYPE_VALUES as string[]).includes(value);
}

export interface RunReportOptions {
  type: ReportType;
  from: string;
  to: string;
  pin?: string | null;
  branch?: string | null;
}

export interface RunReportResult extends ReportResult {
  requestedTo: string;
}

/**
 * Fetch and build one report.
 *
 * The range is capped (H7): a caller cannot ask for a decade of days and make
 * the server materialise it in memory. When the cap bites, `truncated` is set so
 * the UI and the export header can say so rather than silently under-reporting.
 */
export async function runReport(
  supabase: SupabaseClient,
  options: RunReportOptions,
): Promise<RunReportResult> {
  const { type, from, pin, branch } = options;
  const requestedTo = options.to;

  const requestedDays = diffDays(requestedTo, from) + 1;
  const truncated = requestedDays > MAX_RANGE_DAYS;
  const to = truncated ? addDays(from, MAX_RANGE_DAYS - 1) : requestedTo;

  let query = supabase
    .from('attendance_days')
    .select(
      'pin, work_date, status, expected_minutes, worked_minutes, late_minutes, early_leave_minutes, overtime_minutes, punch_count, first_in, last_out, shift_id',
    )
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: true })
    .order('pin', { ascending: true });

  if (pin && pin !== 'all') query = query.eq('pin', pin);

  const [daysResult, employeesResult] = await Promise.all([
    query,
    supabase.from('employees').select('pin, full_name, department, branch'),
  ]);

  if (daysResult.error) throw new Error(daysResult.error.message);

  const employees = (employeesResult.data ?? []) as EmployeeInput[];
  const employeeMap = new Map(employees.map((employee) => [employee.pin, employee]));

  let days = (daysResult.data ?? []) as AttendanceDayInput[];

  if (branch && branch !== 'all') {
    days = days.filter((day) => employeeMap.get(day.pin)?.branch === branch);
  }

  const report = buildReport(type, { from, to, days, employees, truncated });
  return { ...report, requestedTo };
}
