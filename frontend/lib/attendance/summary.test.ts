import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHours, minutesToHours, summariseDays, type PayslipDayInput } from './summary.ts';

/** A working day that came in on time. */
function day(overrides: Partial<PayslipDayInput> = {}): PayslipDayInput {
  return {
    status: 'present',
    expected_minutes: 480,
    worked_minutes: 480,
    late_minutes: 0,
    early_leave_minutes: 0,
    overtime_minutes: 0,
    punch_count: 2,
    ...overrides,
  };
}

test('summary: an empty period is all zeroes, never NaN', () => {
  const summary = summariseDays([]);
  assert.equal(summary.days, 0);
  assert.equal(summary.scheduledDays, 0);
  assert.equal(summary.workedMinutes, 0);
  assert.equal(summary.attendanceRate, 0);
});

test('summary: counts each status into its own bucket', () => {
  const summary = summariseDays([
    day(),
    day({ status: 'late', late_minutes: 20 }),
    day({ status: 'incomplete', punch_count: 1, worked_minutes: 300 }),
    day({ status: 'absent', worked_minutes: 0, punch_count: 0 }),
    day({ status: 'leave', expected_minutes: 0, worked_minutes: 0, punch_count: 0 }),
    day({ status: 'holiday', expected_minutes: 0, worked_minutes: 0, punch_count: 0 }),
    day({ status: 'off', expected_minutes: 0, worked_minutes: 0, punch_count: 0 }),
  ]);

  assert.equal(summary.days, 7);
  assert.equal(summary.presentDays, 1);
  assert.equal(summary.lateDays, 1);
  assert.equal(summary.incompleteDays, 1);
  assert.equal(summary.absentDays, 1);
  assert.equal(summary.leaveDays, 1);
  assert.equal(summary.holidayDays, 1);
  assert.equal(summary.offDays, 1);
  // present + late + incomplete + absent
  assert.equal(summary.scheduledDays, 4);
});

test('summary: minutes add up across the period', () => {
  const summary = summariseDays([
    day({ worked_minutes: 480, overtime_minutes: 30 }),
    day({ worked_minutes: 450, late_minutes: 15, overtime_minutes: 0 }),
  ]);

  assert.equal(summary.workedMinutes, 930);
  assert.equal(summary.expectedMinutes, 960);
  assert.equal(summary.overtimeMinutes, 30);
  assert.equal(summary.lateMinutes, 15);
  assert.equal(summary.punchCount, 4);
});

test('summary: attendance rate is worked ÷ expected', () => {
  const summary = summariseDays([day({ worked_minutes: 240, expected_minutes: 480 })]);
  assert.equal(summary.attendanceRate, 0.5);
});

test('summary: a null or missing figure counts as zero, not a broken total', () => {
  const summary = summariseDays([
    {
      status: 'present',
      worked_minutes: null,
      expected_minutes: undefined,
      overtime_minutes: null,
      punch_count: null,
    },
  ]);

  assert.equal(summary.workedMinutes, 0);
  assert.equal(summary.expectedMinutes, 0);
  assert.equal(summary.attendanceRate, 0);
  assert.equal(summary.presentDays, 1);
});

test('summary: hours are formatted the way a payslip reads', () => {
  assert.equal(minutesToHours(90), 1.5);
  assert.equal(formatHours(0), '0:00');
  assert.equal(formatHours(465), '7:45');
  assert.equal(formatHours(-10), '0:00');
  assert.equal(formatHours(Number.NaN), '0:00');
});
