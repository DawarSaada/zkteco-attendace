import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, diffDays } from '@/lib/attendance/engine';
import {
  MAX_RANGE_DAYS,
  buildReport,
  type EmployeeInput,
  type ReportResult,
  type ReportType,
} from './engine';
import { fetchAllPages, loadReportDays } from './source';

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
  /** Days whose figures come from the engine's computed table. */
  engineDays: number;
  /**
   * Days taken from the legacy punch-log view because the engine has not
   * computed them. Their late/overtime figures are only as good as the shift
   * assignment behind them (see `legacyRowToDay`), so they are reported
   * separately instead of being blended into the totals silently.
   */
  derivedDays: number;
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

  // Reads the engine overlaid on the legacy view, paged past PostgREST's row
  // cap: a pack must never be narrower than the range it was asked for.
  const [dayResult, employeesResult] = await Promise.all([
    loadReportDays(supabase, { start: from, end: to, pin }),
    fetchAllPages<EmployeeInput>((skip, limit) =>
      supabase
        .from('employees')
        .select('pin, full_name, department, branch')
        .order('pin', { ascending: true })
        .range(skip, limit),
    ),
  ]);

  const employees = employeesResult;
  const employeeMap = new Map(employees.map((employee) => [employee.pin, employee]));

  let days = dayResult.days;

  if (branch && branch !== 'all') {
    days = days.filter((day) => employeeMap.get(day.pin)?.branch === branch);
  }

  const report = buildReport(type, { from, to, days, employees, truncated });
  return {
    ...report,
    requestedTo,
    engineDays: dayResult.engineDays,
    derivedDays: dayResult.derivedDays,
  };
}
