import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, type AttendanceDayInput, type EmployeeInput } from './engine.ts';

/**
 * Phase 5 acceptance: every report reconciles to the same `attendance_days`
 * fixture. If Excel, PDF and the JSON API disagree, it is because they are not
 * all reading this function's output.
 */

const employees: EmployeeInput[] = [
  { pin: 'E1', full_name: 'Amina', department: 'Ops', branch: 'Uni' },
  { pin: 'E2', full_name: 'Bilal', department: 'Ops', branch: 'Uni' },
  { pin: 'E3', full_name: 'Cyrus', department: 'Security', branch: 'Main' },
];

function day(partial: Partial<AttendanceDayInput> & { pin: string; work_date: string }): AttendanceDayInput {
  return {
    status: 'present',
    expected_minutes: 480,
    worked_minutes: 480,
    late_minutes: 0,
    early_leave_minutes: 0,
    overtime_minutes: 0,
    punch_count: 2,
    first_in: `${partial.work_date}T09:00:00.000Z`,
    last_out: `${partial.work_date}T17:00:00.000Z`,
    shift_id: 'day',
    ...partial,
  };
}

const days: AttendanceDayInput[] = [
  // E1 — two clean days.
  day({ pin: 'E1', work_date: '2026-08-01' }),
  day({ pin: 'E1', work_date: '2026-08-02' }),
  // E2 — late one day, absent the next, overtime on a third.
  day({ pin: 'E2', work_date: '2026-08-01', status: 'late', late_minutes: 35, worked_minutes: 445 }),
  day({ pin: 'E2', work_date: '2026-08-02', status: 'absent', worked_minutes: 0, punch_count: 0, first_in: null, last_out: null }),
  day({ pin: 'E2', work_date: '2026-08-03', worked_minutes: 600, overtime_minutes: 120 }),
  // E3 — incomplete day (single punch) + early leave.
  day({ pin: 'E3', work_date: '2026-08-01', status: 'incomplete', worked_minutes: 0, punch_count: 1, last_out: null }),
  day({ pin: 'E3', work_date: '2026-08-02', early_leave_minutes: 45, worked_minutes: 435 }),
];

const input = { from: '2026-08-01', to: '2026-08-31', days, employees, generatedAt: '2026-09-01T00:00:00.000Z' };

test('timecard: one row per employee with hand-computed totals', () => {
  const report = buildReport('timecard', input);
  assert.equal(report.rowCount, 3);

  const amina = report.rows.find((row) => row.pin === 'E1')!;
  assert.equal(amina.days_worked, 2);
  assert.equal(amina.worked_hours, 16);
  assert.equal(amina.balance_hours, 0);
  assert.equal(amina.late_minutes, 0);

  const bilal = report.rows.find((row) => row.pin === 'E2')!;
  assert.equal(bilal.days_absent, 1);
  assert.equal(bilal.days_worked, 2);
  assert.equal(bilal.worked_hours, Math.round(((445 + 600) / 60) * 100) / 100);
  assert.equal(bilal.late_minutes, 35);
  assert.equal(bilal.overtime_hours, 2);

  const cyrus = report.rows.find((row) => row.pin === 'E3')!;
  assert.equal(cyrus.early_leave_minutes, 45);
  // One incomplete day contributes 0 worked minutes, so only the second day counts.
  assert.equal(cyrus.worked_hours, Math.round((435 / 60) * 100) / 100);
});

test('timecard: totals reconcile to the fixture', () => {
  const report = buildReport('timecard', input);
  const workedMinutes = days.reduce((sum, d) => sum + d.worked_minutes, 0);
  assert.equal(report.totals.worked_hours, Math.round((workedMinutes / 60) * 100) / 100);
  assert.equal(report.totals.overtime_hours, 2);
});

test('exceptions: late, absent, incomplete and early leave', () => {
  const report = buildReport('exceptions', input);
  // E2 late, E2 absent, E3 incomplete, E3 early leave = 4
  assert.equal(report.rowCount, 4);
  assert.ok(report.rows.some((row) => row.status === 'incomplete'));
  assert.ok(report.rows.some((row) => row.status === 'absent'));
});

test('absence: only absent rows', () => {
  const report = buildReport('absence', input);
  assert.equal(report.rowCount, 1);
  assert.equal(report.rows[0].pin, 'E2');
  assert.equal(report.rows[0].date, '2026-08-02');
});

test('overtime: only days with overtime, reconciled total', () => {
  const report = buildReport('overtime', input);
  assert.equal(report.rowCount, 1);
  assert.equal(report.rows[0].overtime_hours, 2);
  assert.equal(report.totals.overtime_hours, 2);
});

test('late: only late rows with the check-in time', () => {
  const report = buildReport('late', input);
  assert.equal(report.rowCount, 1);
  assert.equal(report.rows[0].late_minutes, 35);
  assert.equal(report.rows[0].check_in, '09:00');
  assert.equal(report.totals.late_minutes, 35);
});

test('rollup: grouped by branch and department', () => {
  const report = buildReport('rollup', input);
  // Uni/Ops (E1, E2) and Main/Security (E3)
  assert.equal(report.rowCount, 2);

  const ops = report.rows.find((row) => row.branch === 'Uni')!;
  assert.equal(ops.department, 'Ops');
  assert.equal(ops.employees, 2);
  assert.equal(ops.absences, 1);
  assert.equal(ops.late_minutes, 35);

  const security = report.rows.find((row) => row.branch === 'Main')!;
  assert.equal(security.employees, 1);
  assert.equal(security.absences, 0);
});

test('rollup totals reconcile with the timecard totals', () => {
  const timecard = buildReport('timecard', input);
  const rollup = buildReport('rollup', input);
  assert.equal(rollup.totals.worked_hours, timecard.totals.worked_hours);
});

test('every report carries the requested period and a column set', () => {
  for (const type of ['timecard', 'exceptions', 'absence', 'overtime', 'rollup', 'late'] as const) {
    const report = buildReport(type, input);
    assert.equal(report.from, '2026-08-01');
    assert.equal(report.to, '2026-08-31');
    assert.ok(report.columns.length > 0, `${type} has columns`);
    assert.equal(report.generatedAt, '2026-09-01T00:00:00.000Z');
  }
});

test('an empty range produces zero rows, not an error', () => {
  const report = buildReport('timecard', { ...input, days: [] });
  assert.equal(report.rowCount, 0);
  assert.deepEqual(report.rows, []);
});
