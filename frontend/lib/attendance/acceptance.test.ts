import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY,
  evaluateDay,
  groupPunchesByWorkDate,
  type AttendancePolicy,
  type EvaluatedDay,
  type ExpectedShift,
  type ShiftPeriod,
} from './engine.ts';

/**
 * Phase 1 acceptance test (BIOTIME_PARITY.md §4 Phase 1.6).
 *
 * A 31-day month, five employees, two shift patterns, every status the engine
 * can produce, and — the case that is a live correctness bug — an overnight
 * shift that must yield exactly ONE row per night.
 */

const MONTH_START = '2026-08-01';
const MONTH_END = '2026-08-31';

function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const DAYS = datesInRange(MONTH_START, MONTH_END);
assert.equal(DAYS.length, 31);

function at(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Every calendar day is a working day in the fixture so the arithmetic is
// unambiguous; weekday/employee-independent behaviour is covered in engine.test.ts.
const policy: AttendancePolicy = {
  ...DEFAULT_POLICY,
  graceInMinutes: 10,
  graceOutMinutes: 0,
  overtimeAfterMinutes: 30,
  weekendDays: [],
};

const dayPeriods: ShiftPeriod[] = [
  { seq: 1, startTime: '09:00', endTime: '17:00', dayOffset: 0 },
];
const nightPeriods: ShiftPeriod[] = [
  { seq: 1, startTime: '22:00', endTime: '06:00', dayOffset: 1 },
];

const dayShift: ExpectedShift = { shiftId: 'day', name: 'Day', periods: dayPeriods };
const nightShift: ExpectedShift = { shiftId: 'night', name: 'Night', periods: nightPeriods };

interface Employee {
  pin: string;
  shift: ExpectedShift;
  punches: string[];
  holidayDate?: string;
}

function buildEmployees(): Employee[] {
  const employees: Employee[] = [];

  // E1 — full month, on time, plus one long day (2026-08-03) worth overtime.
  {
    const punches: string[] = [];
    for (const date of DAYS) {
      if (date === '2026-08-03') {
        punches.push(at(date, '09:00'), at(date, '18:00'));
      } else {
        punches.push(at(date, '08:58'), at(date, '17:02'));
      }
    }
    employees.push({ pin: 'E1', shift: dayShift, punches });
  }

  // E2 — absent on 2026-08-10, late by 40 minutes on 2026-08-05 (grace 10 ⇒ 30).
  {
    const punches: string[] = [];
    for (const date of DAYS) {
      if (date === '2026-08-10') continue;
      if (date === '2026-08-05') {
        punches.push(at(date, '09:40'), at(date, '17:00'));
      } else {
        punches.push(at(date, '08:58'), at(date, '17:02'));
      }
    }
    employees.push({ pin: 'E2', shift: dayShift, punches });
  }

  // E3 — overnight every night: in at 22:00, out at 06:00 the next morning.
  {
    const punches: string[] = [];
    for (const date of DAYS) {
      punches.push(at(date, '22:00'), at(nextDay(date), '06:00'));
    }
    employees.push({ pin: 'E3', shift: nightShift, punches });
  }

  // E4 — a non-working holiday on 2026-08-15 (no punches that day).
  {
    const punches: string[] = [];
    for (const date of DAYS) {
      if (date === '2026-08-15') continue;
      punches.push(at(date, '08:58'), at(date, '17:02'));
    }
    employees.push({ pin: 'E4', shift: dayShift, punches, holidayDate: '2026-08-15' });
  }

  // E5 — early leave on 2026-08-20 (out at 16:30 ⇒ 30 minutes short).
  {
    const punches: string[] = [];
    for (const date of DAYS) {
      if (date === '2026-08-20') {
        punches.push(at(date, '08:55'), at(date, '16:30'));
      } else {
        punches.push(at(date, '08:58'), at(date, '17:02'));
      }
    }
    employees.push({ pin: 'E5', shift: dayShift, punches });
  }

  return employees;
}

/** Mimics the recompute pipeline: bucket punches by work date, then evaluate. */
function computeEmployee(employee: Employee): Map<string, EvaluatedDay> {
  const buckets = groupPunchesByWorkDate(employee.punches, employee.shift.periods);
  const rows = new Map<string, EvaluatedDay>();
  for (const date of DAYS) {
    const holiday =
      date === employee.holidayDate
        ? { date, name: 'Fixture holiday', isWorkingDay: false }
        : null;
    rows.set(
      date,
      evaluateDay({
        workDate: date,
        punches: buckets.get(date) ?? [],
        shift: employee.shift,
        policy,
        holiday,
        leave: null,
      }),
    );
  }
  return rows;
}

const results = buildEmployees().map((employee) => ({
  employee,
  rows: computeEmployee(employee),
}));

test('produces exactly one row per employee per day (155 rows)', () => {
  const total = results.reduce((sum, r) => sum + r.rows.size, 0);
  assert.equal(total, 155);
});

test('the overnight shift yields one row per night, not two (31 rows)', () => {
  const e3 = results.find((r) => r.employee.pin === 'E3');
  assert.ok(e3);
  assert.equal(e3.rows.size, 31); // would be ~62 with the old MIN/MAX view
  assert.deepEqual([...e3.rows.keys()].sort(), DAYS);

  // The 06:00 punch on 2026-08-02 belongs to 2026-08-01's row.
  const firstNight = e3.rows.get('2026-08-01');
  assert.equal(firstNight?.punchCount, 2);
  assert.equal(firstNight?.status, 'present');
  assert.equal(firstNight?.workedMinutes, 480);
  assert.equal(firstNight?.firstIn, at('2026-08-01', '22:00'));
  assert.equal(firstNight?.lastOut, at('2026-08-02', '06:00'));
});

test('E1: a full clean month with a single overtime day', () => {
  const e1 = results.find((r) => r.employee.pin === 'E1')!;
  const statuses = [...e1.rows.values()].map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 'present').length, 31);

  const otDay = e1.rows.get('2026-08-03')!;
  assert.equal(otDay.workedMinutes, 540);
  assert.equal(otDay.overtimeMinutes, 60);

  const regularDay = e1.rows.get('2026-08-04')!;
  assert.equal(regularDay.workedMinutes, 484);
  assert.equal(regularDay.overtimeMinutes, 0);
  assert.equal(regularDay.earlyLeaveMinutes, 0);
});

test('E2: one absence and one late arrival, hand-computed', () => {
  const e2 = results.find((r) => r.employee.pin === 'E2')!;
  const absent = [...e2.rows.values()].filter((r) => r.status === 'absent');
  assert.equal(absent.length, 1);
  assert.equal(absent[0].workDate, '2026-08-10');
  assert.equal(absent[0].expectedMinutes, 480);

  const late = [...e2.rows.values()].filter((r) => r.status === 'late');
  assert.equal(late.length, 1);
  assert.equal(late[0].workDate, '2026-08-05');
  assert.equal(late[0].lateMinutes, 30);

  const present = [...e2.rows.values()].filter((r) => r.status === 'present');
  assert.equal(present.length, 29);
});

test('E4: the holiday is neither an absence nor overtime', () => {
  const e4 = results.find((r) => r.employee.pin === 'E4')!;
  const holiday = e4.rows.get('2026-08-15')!;
  assert.equal(holiday.status, 'holiday');
  assert.equal(holiday.expectedMinutes, 0);
  assert.equal(holiday.overtimeMinutes, 0);

  const absences = [...e4.rows.values()].filter((r) => r.status === 'absent');
  assert.equal(absences.length, 0);
});

test('E5: the short day is an early leave, not an absence', () => {
  const e5 = results.find((r) => r.employee.pin === 'E5')!;
  const short = e5.rows.get('2026-08-20')!;
  assert.equal(short.status, 'present');
  assert.equal(short.earlyLeaveMinutes, 30);
  assert.equal(short.workedMinutes, 455);
});

test('every row carries the shift id and the expected shift length', () => {
  for (const { employee, rows } of results) {
    for (const row of rows.values()) {
      assert.equal(row.shiftId, employee.shift.shiftId);
      // A rest/holiday day carries no expected obligation.
      assert.equal(row.expectedMinutes, row.status === 'holiday' ? 0 : 480);
    }
  }
});
