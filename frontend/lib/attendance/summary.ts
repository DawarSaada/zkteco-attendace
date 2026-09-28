import type { AttendanceDayStatus } from './engine';

/**
 * Payslip-hours summary.
 *
 * Pure aggregation over `attendance_days` rows — the same numbers the reports
 * engine already trusts, totalled for one person and one period. It lives here
 * (not in the route) because the self-service page and any future payslip
 * export must agree to the minute, and the only way to guarantee that is one
 * implementation with tests.
 */

export interface PayslipDayInput {
  status: AttendanceDayStatus;
  work_date?: string | null;
  expected_minutes?: number | null;
  worked_minutes?: number | null;
  late_minutes?: number | null;
  early_leave_minutes?: number | null;
  overtime_minutes?: number | null;
  punch_count?: number | null;
}

export interface PayslipSummary {
  /** Every row in the period, including rest days. */
  days: number;
  /** Days the employee was expected to be at work. */
  scheduledDays: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  incompleteDays: number;
  leaveDays: number;
  holidayDays: number;
  offDays: number;
  workedMinutes: number;
  expectedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  punchCount: number;
  /** worked ÷ expected, rounded to 3 dp; 0 when nothing was expected. */
  attendanceRate: number;
}

const SCHEDULED_STATUSES: AttendanceDayStatus[] = ['present', 'late', 'incomplete', 'absent'];

function safe(value: number | null | undefined): number {
  return Number.isFinite(value ?? NaN) ? (value as number) : 0;
}

export function summariseDays(days: PayslipDayInput[]): PayslipSummary {
  const summary: PayslipSummary = {
    days: days.length,
    scheduledDays: 0,
    presentDays: 0,
    lateDays: 0,
    absentDays: 0,
    incompleteDays: 0,
    leaveDays: 0,
    holidayDays: 0,
    offDays: 0,
    workedMinutes: 0,
    expectedMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    punchCount: 0,
    attendanceRate: 0,
  };

  for (const day of days) {
    switch (day.status) {
      case 'present':
        summary.presentDays += 1;
        break;
      case 'late':
        summary.lateDays += 1;
        break;
      case 'absent':
        summary.absentDays += 1;
        break;
      case 'incomplete':
        summary.incompleteDays += 1;
        break;
      case 'leave':
        summary.leaveDays += 1;
        break;
      case 'holiday':
        summary.holidayDays += 1;
        break;
      case 'off':
        summary.offDays += 1;
        break;
    }

    if (SCHEDULED_STATUSES.includes(day.status)) summary.scheduledDays += 1;

    const worked = safe(day.worked_minutes);
    summary.workedMinutes += worked;
    summary.expectedMinutes += safe(day.expected_minutes);
    summary.lateMinutes += safe(day.late_minutes);
    summary.earlyLeaveMinutes += safe(day.early_leave_minutes);
    summary.overtimeMinutes += safe(day.overtime_minutes);
    summary.punchCount += safe(day.punch_count);
  }

  summary.attendanceRate =
    summary.expectedMinutes > 0
      ? Math.round((summary.workedMinutes / summary.expectedMinutes) * 1000) / 1000
      : 0;

  return summary;
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/** `H:MM`, the shape a payslip reads in. */
export function formatHours(minutes: number): string {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return `${hours}:${String(rest).padStart(2, '0')}`;
}
