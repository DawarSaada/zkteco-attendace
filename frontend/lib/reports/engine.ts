/**
 * Report pack engine.
 *
 * Every report is produced here, from the same `attendance_days` rows, with the
 * same column definitions. The JSON endpoint, the Excel export and the PDF
 * export all consume `buildReport()`, so a number can never differ between them
 * — the failure mode this replaces was Excel and PDF each querying the raw view
 * and formatting it their own way.
 *
 * `buildReport()` is pure (no I/O) so it can be unit tested against a fixture;
 * the caller fetches the rows.
 */

export type ReportType = 'timecard' | 'exceptions' | 'absence' | 'overtime' | 'rollup' | 'late';

export interface AttendanceDayInput {
  pin: string;
  work_date: string;
  status: string;
  expected_minutes: number;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  punch_count: number;
  first_in: string | null;
  last_out: string | null;
  shift_id: string | null;
}

export interface EmployeeInput {
  pin: string;
  full_name: string | null;
  department: string | null;
  branch: string | null;
}

export interface ReportColumn {
  key: string;
  label: string;
  numeric?: boolean;
  width?: number;
}

export interface ReportResult {
  type: ReportType;
  title: string;
  from: string;
  to: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
  rowCount: number;
  /** True when the requested range exceeded the engine's cap. */
  truncated: boolean;
}

export const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'timecard', label: 'Monthly summary (timecard)' },
  { value: 'exceptions', label: 'Exception report' },
  { value: 'absence', label: 'Absence report' },
  { value: 'overtime', label: 'Overtime report' },
  { value: 'rollup', label: 'Department / branch rollup' },
  { value: 'late', label: 'Late arrivals' },
];

const REPORT_TITLES: Record<ReportType, string> = {
  timecard: 'Monthly Summary (Timecard)',
  exceptions: 'Exception Report',
  absence: 'Absence Report',
  overtime: 'Overtime Report',
  rollup: 'Department / Branch Rollup',
  late: 'Late Arrival Report',
};

export const MAX_RANGE_DAYS = 400;

function hours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function isException(day: AttendanceDayInput): boolean {
  return (
    day.status === 'late' ||
    day.status === 'absent' ||
    day.status === 'incomplete' ||
    day.early_leave_minutes > 0
  );
}

export interface BuildReportInput {
  from: string;
  to: string;
  days: AttendanceDayInput[];
  employees: EmployeeInput[];
  truncated?: boolean;
  generatedAt?: string;
}

export function buildReport(type: ReportType, input: BuildReportInput): ReportResult {
  const { from, to, days, employees } = input;
  const employeeByPin = new Map(employees.map((employee) => [employee.pin, employee]));
  const nameOf = (pin: string) => employeeByPin.get(pin)?.full_name || `PIN ${pin}`;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const truncated = !!input.truncated;

  const base = {
    type,
    title: REPORT_TITLES[type],
    from,
    to,
    generatedAt,
    truncated,
  };

  if (type === 'timecard') {
    const columns: ReportColumn[] = [
      { key: 'pin', label: 'PIN', width: 12 },
      { key: 'employee', label: 'Employee', width: 28 },
      { key: 'department', label: 'Department', width: 18 },
      { key: 'branch', label: 'Branch', width: 16 },
      { key: 'days_worked', label: 'Days worked', numeric: true, width: 12 },
      { key: 'days_absent', label: 'Days absent', numeric: true, width: 12 },
      { key: 'expected_hours', label: 'Expected (h)', numeric: true, width: 12 },
      { key: 'worked_hours', label: 'Worked (h)', numeric: true, width: 12 },
      { key: 'balance_hours', label: 'Balance (h)', numeric: true, width: 12 },
      { key: 'late_minutes', label: 'Late (min)', numeric: true, width: 12 },
      { key: 'early_leave_minutes', label: 'Early leave (min)', numeric: true, width: 14 },
      { key: 'overtime_hours', label: 'Overtime (h)', numeric: true, width: 12 },
    ];

    const grouped = new Map<string, AttendanceDayInput[]>();
    for (const day of days) {
      const list = grouped.get(day.pin);
      if (list) list.push(day);
      else grouped.set(day.pin, [day]);
    }

    const rows = [...grouped.entries()]
      .sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))
      .map(([pin, list]) => {
        const employee = employeeByPin.get(pin);
        const expected = list.reduce((sum, day) => sum + day.expected_minutes, 0);
        const worked = list.reduce((sum, day) => sum + day.worked_minutes, 0);
        return {
          pin,
          employee: nameOf(pin),
          department: employee?.department ?? '',
          branch: employee?.branch ?? '',
          days_worked: list.filter((day) => day.worked_minutes > 0).length,
          days_absent: list.filter((day) => day.status === 'absent').length,
          expected_hours: hours(expected),
          worked_hours: hours(worked),
          balance_hours: hours(worked - expected),
          late_minutes: list.reduce((sum, day) => sum + day.late_minutes, 0),
          early_leave_minutes: list.reduce((sum, day) => sum + day.early_leave_minutes, 0),
          overtime_hours: hours(list.reduce((sum, day) => sum + day.overtime_minutes, 0)),
        };
      });

    return {
      ...base,
      columns,
      rows,
      rowCount: rows.length,
      totals: {
        worked_hours: hours(days.reduce((sum, day) => sum + day.worked_minutes, 0)),
        overtime_hours: hours(days.reduce((sum, day) => sum + day.overtime_minutes, 0)),
        late_minutes: days.reduce((sum, day) => sum + day.late_minutes, 0),
      },
    };
  }

  if (type === 'exceptions') {
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Date', width: 14 },
      { key: 'pin', label: 'PIN', width: 12 },
      { key: 'employee', label: 'Employee', width: 26 },
      { key: 'status', label: 'Status', width: 14 },
      { key: 'punches', label: 'Punches', numeric: true, width: 10 },
      { key: 'late_minutes', label: 'Late (min)', numeric: true, width: 12 },
      { key: 'early_leave_minutes', label: 'Early leave (min)', numeric: true, width: 14 },
      { key: 'overtime_hours', label: 'Overtime (h)', numeric: true, width: 12 },
    ];
    const rows = days
      .filter(isException)
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.pin.localeCompare(b.pin))
      .map((day) => ({
        date: day.work_date,
        pin: day.pin,
        employee: nameOf(day.pin),
        status: day.status,
        punches: day.punch_count,
        late_minutes: day.late_minutes,
        early_leave_minutes: day.early_leave_minutes,
        overtime_hours: hours(day.overtime_minutes),
      }));
    return {
      ...base,
      columns,
      rows,
      rowCount: rows.length,
      totals: { exceptions: rows.length, late_minutes: rows.reduce((s, r) => s + Number(r.late_minutes), 0) },
    };
  }

  if (type === 'absence') {
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Date', width: 14 },
      { key: 'pin', label: 'PIN', width: 12 },
      { key: 'employee', label: 'Employee', width: 26 },
      { key: 'department', label: 'Department', width: 18 },
      { key: 'branch', label: 'Branch', width: 16 },
      { key: 'expected_hours', label: 'Expected (h)', numeric: true, width: 12 },
    ];
    const rows = days
      .filter((day) => day.status === 'absent')
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.pin.localeCompare(b.pin))
      .map((day) => ({
        date: day.work_date,
        pin: day.pin,
        employee: nameOf(day.pin),
        department: employeeByPin.get(day.pin)?.department ?? '',
        branch: employeeByPin.get(day.pin)?.branch ?? '',
        expected_hours: hours(day.expected_minutes),
      }));
    return {
      ...base,
      columns,
      rows,
      rowCount: rows.length,
      totals: { absences: rows.length },
    };
  }

  if (type === 'overtime') {
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Date', width: 14 },
      { key: 'pin', label: 'PIN', width: 12 },
      { key: 'employee', label: 'Employee', width: 26 },
      { key: 'worked_hours', label: 'Worked (h)', numeric: true, width: 12 },
      { key: 'overtime_hours', label: 'Overtime (h)', numeric: true, width: 12 },
      { key: 'status', label: 'Status', width: 14 },
    ];
    const rows = days
      .filter((day) => day.overtime_minutes > 0)
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.pin.localeCompare(b.pin))
      .map((day) => ({
        date: day.work_date,
        pin: day.pin,
        employee: nameOf(day.pin),
        worked_hours: hours(day.worked_minutes),
        overtime_hours: hours(day.overtime_minutes),
        status: day.status,
      }));
    return {
      ...base,
      columns,
      rows,
      rowCount: rows.length,
      totals: {
        overtime_hours: hours(days.reduce((sum, day) => sum + day.overtime_minutes, 0)),
      },
    };
  }

  if (type === 'late') {
    const columns: ReportColumn[] = [
      { key: 'date', label: 'Date', width: 14 },
      { key: 'pin', label: 'PIN', width: 12 },
      { key: 'employee', label: 'Employee', width: 26 },
      { key: 'check_in', label: 'Check-in', width: 18 },
      { key: 'late_minutes', label: 'Late (min)', numeric: true, width: 12 },
    ];
    const rows = days
      .filter((day) => day.late_minutes > 0)
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.pin.localeCompare(b.pin))
      .map((day) => ({
        date: day.work_date,
        pin: day.pin,
        employee: nameOf(day.pin),
        check_in: day.first_in ? day.first_in.slice(11, 16) : '',
        late_minutes: day.late_minutes,
      }));
    return {
      ...base,
      columns,
      rows,
      rowCount: rows.length,
      totals: { late_minutes: rows.reduce((sum, row) => sum + Number(row.late_minutes), 0) },
    };
  }

  // rollup
  const columns: ReportColumn[] = [
    { key: 'branch', label: 'Branch', width: 18 },
    { key: 'department', label: 'Department', width: 20 },
    { key: 'employees', label: 'Employees', numeric: true, width: 12 },
    { key: 'days_worked', label: 'Days worked', numeric: true, width: 12 },
    { key: 'expected_hours', label: 'Expected (h)', numeric: true, width: 12 },
    { key: 'worked_hours', label: 'Worked (h)', numeric: true, width: 12 },
    { key: 'overtime_hours', label: 'Overtime (h)', numeric: true, width: 12 },
    { key: 'late_minutes', label: 'Late (min)', numeric: true, width: 12 },
    { key: 'absences', label: 'Absences', numeric: true, width: 12 },
  ];

  const buckets = new Map<
    string,
    { branch: string; department: string; pins: Set<string>; daysWorked: number; expected: number; worked: number; overtime: number; late: number; absences: number }
  >();

  for (const day of days) {
    const employee = employeeByPin.get(day.pin);
    const branch = employee?.branch ?? 'Unassigned';
    const department = employee?.department ?? 'Unassigned';
    const key = `${branch}|${department}`;
    const bucket = buckets.get(key) ?? {
      branch,
      department,
      pins: new Set<string>(),
      daysWorked: 0,
      expected: 0,
      worked: 0,
      overtime: 0,
      late: 0,
      absences: 0,
    };
    bucket.pins.add(day.pin);
    if (day.worked_minutes > 0) bucket.daysWorked += 1;
    bucket.expected += day.expected_minutes;
    bucket.worked += day.worked_minutes;
    bucket.overtime += day.overtime_minutes;
    bucket.late += day.late_minutes;
    if (day.status === 'absent') bucket.absences += 1;
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()]
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.department.localeCompare(b.department))
    .map((bucket) => ({
      branch: bucket.branch,
      department: bucket.department,
      employees: bucket.pins.size,
      days_worked: bucket.daysWorked,
      expected_hours: hours(bucket.expected),
      worked_hours: hours(bucket.worked),
      overtime_hours: hours(bucket.overtime),
      late_minutes: bucket.late,
      absences: bucket.absences,
    }));

  return {
    ...base,
    columns,
    rows,
    rowCount: rows.length,
    totals: {
      worked_hours: hours(days.reduce((sum, day) => sum + day.worked_minutes, 0)),
      overtime_hours: hours(days.reduce((sum, day) => sum + day.overtime_minutes, 0)),
      absences: days.filter((day) => day.status === 'absent').length,
    },
  };
}
