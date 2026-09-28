import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POLICY,
  evaluateDay,
  groupPunchesByWorkDate,
  parseTimeToMinutes,
  periodBounds,
  resolveWorkDate,
  shiftWindow,
  type AttendancePolicy,
  type ShiftPeriod,
} from './engine.ts';

/** `${date}T${hh}:${mm}:00.000Z` — mirrors how the app stores device wall-clock. */
function at(date: string, time: string): string {
  return `${date}T${time}:00.000Z`;
}

/** Tue 2026-09-01 (weekday 2 — not a weekend in the default Fri/Sat policy). */
const TUE = '2026-09-01';
/** Fri 2026-09-04 (weekday 5 — a weekend day). */
const FRI = '2026-09-04';

const dayShift: ShiftPeriod[] = [
  { seq: 1, startTime: '09:00', endTime: '17:00', dayOffset: 0 },
];
const nightShift: ShiftPeriod[] = [
  { seq: 1, startTime: '22:00', endTime: '06:00', dayOffset: 1 },
];

const policy: AttendancePolicy = { ...DEFAULT_POLICY };

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

test('parseTimeToMinutes handles HH:MM and HH:MM:SS', () => {
  assert.equal(parseTimeToMinutes('09:30'), 570);
  assert.equal(parseTimeToMinutes('22:00:00'), 1320);
});

test('periodBounds: daytime period stays within the day', () => {
  assert.deepEqual(periodBounds(dayShift[0]), { seq: 1, startAbs: 540, endAbs: 1020 });
});

test('periodBounds: overnight period ends past midnight', () => {
  assert.deepEqual(periodBounds(nightShift[0]), { seq: 1, startAbs: 1320, endAbs: 1800 });
});

test('periodBounds: end<=start implies overnight even at dayOffset 0', () => {
  const implicit: ShiftPeriod = { seq: 1, startTime: '22:00', endTime: '06:00', dayOffset: 0 };
  assert.deepEqual(periodBounds(implicit), { seq: 1, startAbs: 1320, endAbs: 1800 });
});

test('shiftWindow spans the earliest start to the latest end', () => {
  const split: ShiftPeriod[] = [
    { seq: 1, startTime: '08:00', endTime: '12:00', dayOffset: 0 },
    { seq: 2, startTime: '16:00', endTime: '20:00', dayOffset: 0 },
  ];
  assert.deepEqual(shiftWindow(split), { startAbs: 480, endAbs: 1200 });
});

test('shiftWindow is null without periods', () => {
  assert.equal(shiftWindow([]), null);
});

// ---------------------------------------------------------------------------
// Work-date resolution — the cross-midnight bug
// ---------------------------------------------------------------------------

test('overnight: a 02:00 punch belongs to the previous work date', () => {
  const iso = at('2026-09-02', '02:00');
  assert.equal(resolveWorkDate(iso, nightShift).workDate, '2026-09-01');
});

test('overnight: a 23:30 punch belongs to its own work date', () => {
  const iso = at(TUE, '23:30');
  assert.equal(resolveWorkDate(iso, nightShift).workDate, TUE);
});

test('overnight: a punch at exactly 00:00 belongs to the previous work date', () => {
  const iso = at('2026-09-02', '00:00');
  assert.equal(resolveWorkDate(iso, nightShift).workDate, '2026-09-01');
});

test('overnight: a punch at the 06:00 end belongs to the previous work date', () => {
  const iso = at('2026-09-02', '06:00');
  assert.equal(resolveWorkDate(iso, nightShift).workDate, '2026-09-01');
});

test('overnight: a punch slightly after the end still resolves to the shift day', () => {
  const iso = at('2026-09-02', '06:30');
  assert.equal(resolveWorkDate(iso, nightShift).workDate, '2026-09-01');
});

test('day shift: a punch before the first period resolves to the same day', () => {
  const iso = at(TUE, '07:00');
  assert.equal(resolveWorkDate(iso, dayShift).workDate, TUE);
});

test('split shift: a punch in the gap resolves to the same work date', () => {
  const split: ShiftPeriod[] = [
    { seq: 1, startTime: '08:00', endTime: '12:00', dayOffset: 0 },
    { seq: 2, startTime: '16:00', endTime: '20:00', dayOffset: 0 },
  ];
  assert.equal(resolveWorkDate(at(TUE, '14:00'), split).workDate, TUE);
});

test('three-period shift: the late period owns the after-midnight punch', () => {
  const three: ShiftPeriod[] = [
    { seq: 1, startTime: '06:00', endTime: '10:00', dayOffset: 0 },
    { seq: 2, startTime: '14:00', endTime: '18:00', dayOffset: 0 },
    { seq: 3, startTime: '22:00', endTime: '02:00', dayOffset: 1 },
  ];
  assert.equal(resolveWorkDate(at('2026-09-02', '01:00'), three).workDate, '2026-09-01');
  assert.equal(resolveWorkDate(at('2026-09-02', '07:00'), three).workDate, '2026-09-02');
});

test('no shift: the punch keeps its own calendar date', () => {
  assert.equal(resolveWorkDate(at('2026-09-02', '02:00'), []).workDate, '2026-09-02');
});

test('groupPunchesByWorkDate puts a night shift in one bucket', () => {
  const groups = groupPunchesByWorkDate(
    [at('2026-09-01', '22:05'), at('2026-09-02', '05:55')],
    nightShift,
  );
  assert.deepEqual([...groups.keys()], ['2026-09-01']);
  assert.equal(groups.get('2026-09-01')?.length, 2);
});

// ---------------------------------------------------------------------------
// evaluateDay
// ---------------------------------------------------------------------------

const shift = { shiftId: 'shift-1', name: 'Day', periods: dayShift };

test('absent: a rostered working day with no punches', () => {
  const result = evaluateDay({ workDate: TUE, punches: [], shift, policy });
  assert.equal(result.status, 'absent');
  assert.equal(result.expectedMinutes, 480);
  assert.equal(result.workedMinutes, 0);
  assert.equal(result.punchCount, 0);
});

test('unassigned employee with no punches is "off", never absent', () => {
  const result = evaluateDay({ workDate: TUE, punches: [], shift: null, policy });
  assert.equal(result.status, 'off');
});

test('present: a full day with both punches', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '08:55'), at(TUE, '17:05')],
    shift,
    policy,
  });
  assert.equal(result.status, 'present');
  assert.equal(result.workedMinutes, 490);
  assert.equal(result.lateMinutes, 0);
  assert.equal(result.earlyLeaveMinutes, 0);
  assert.equal(result.expectedMinutes, 480);
});

test('late: measured against the first period minus the grace window', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '09:25'), at(TUE, '17:05')],
    shift,
    policy: { ...policy, graceInMinutes: 10 },
  });
  assert.equal(result.status, 'late');
  assert.equal(result.lateMinutes, 15);
});

test('late: within the grace window is not late', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '09:05'), at(TUE, '17:00')],
    shift,
    policy: { ...policy, graceInMinutes: 10 },
  });
  assert.equal(result.status, 'present');
  assert.equal(result.lateMinutes, 0);
});

test('early leave: measured against the last period end minus grace', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '09:00'), at(TUE, '16:30')],
    shift,
    policy: { ...policy, graceOutMinutes: 5 },
  });
  assert.equal(result.status, 'present');
  assert.equal(result.earlyLeaveMinutes, 25);
});

test('overtime: time past the shift beyond the overtime threshold', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '09:00'), at(TUE, '18:00')],
    shift,
    policy: { ...policy, overtimeAfterMinutes: 30 },
  });
  assert.equal(result.workedMinutes, 540);
  assert.equal(result.overtimeMinutes, 60);
});

test('overtime: nothing when under the threshold', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '09:00'), at(TUE, '17:10')],
    shift,
    policy: { ...policy, overtimeAfterMinutes: 30 },
  });
  assert.equal(result.overtimeMinutes, 0);
});

test('incomplete: a single punch on a rostered day', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '09:00')],
    shift,
    policy,
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.lastOut, null);
  assert.equal(result.workedMinutes, 0);
});

test('weekend: a rest day is off, with expected zero and all work as overtime', () => {
  const result = evaluateDay({ workDate: FRI, punches: [], shift, policy });
  assert.equal(result.status, 'off');
  assert.equal(result.expectedMinutes, 0);

  const worked = evaluateDay({
    workDate: FRI,
    punches: [at(FRI, '10:00'), at(FRI, '14:00')],
    shift,
    policy,
  });
  assert.equal(worked.status, 'off');
  assert.equal(worked.overtimeMinutes, 240);
});

test('holiday: a non-working holiday is not an absence', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [],
    shift,
    policy,
    holiday: { date: TUE, name: 'National Day', isWorkingDay: false },
  });
  assert.equal(result.status, 'holiday');
  assert.equal(result.expectedMinutes, 0);
});

test('holiday: a working-day holiday behaves like a normal day', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [],
    shift,
    policy,
    holiday: { date: TUE, name: 'Make-up day', isWorkingDay: true },
  });
  assert.equal(result.status, 'absent');
});

test('leave: an approved leave day is neither absent nor late', () => {
  const result = evaluateDay({
    workDate: TUE,
    punches: [],
    shift,
    policy,
    leave: { isOnLeave: true, type: 'annual' },
  });
  assert.equal(result.status, 'leave');
  assert.equal(result.lateMinutes, 0);
  assert.equal(result.overtimeMinutes, 0);
});

test('multi-period: worked time is the sum of each period', () => {
  const split = {
    shiftId: 'shift-2',
    periods: [
      { seq: 1, startTime: '08:00', endTime: '12:00', dayOffset: 0 },
      { seq: 2, startTime: '16:00', endTime: '20:00', dayOffset: 0 },
    ] as ShiftPeriod[],
  };
  const result = evaluateDay({
    workDate: TUE,
    punches: [at(TUE, '08:00'), at(TUE, '12:00'), at(TUE, '16:00'), at(TUE, '20:00')],
    shift: split,
    policy,
  });
  assert.equal(result.status, 'present');
  assert.equal(result.expectedMinutes, 480);
  assert.equal(result.workedMinutes, 480);
});
