import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PAGES,
  PAGE_SIZE,
  fetchAllPages,
  legacyRowToDay,
  mergeLegacyRows,
  overlayEngineRows,
  rowKey,
  shiftMinutes,
  sortRows,
} from './source.ts';
import type { DailyAttendanceSummary } from '@/types';

function row(partial: Partial<DailyAttendanceSummary> & { pin: string; punch_date: string }): DailyAttendanceSummary {
  return { total_punches: 2, ...partial };
}

test('fetchAllPages keeps reading until a short page comes back', async () => {
  const total = 2500;
  const seen: string[] = [];

  const rows = await fetchAllPages<{ n: number }>(async (from, to) => {
    seen.push(`${from}-${to}`);
    const page = Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, i) => ({
      n: from + i,
    }));
    return { data: page, error: null };
  });

  assert.equal(rows.length, total);
  assert.deepEqual(seen, [
    `0-${PAGE_SIZE - 1}`,
    `${PAGE_SIZE}-${PAGE_SIZE * 2 - 1}`,
    `${PAGE_SIZE * 2}-${PAGE_SIZE * 3 - 1}`,
  ]);
});

test('fetchAllPages does not stop at the first full page', async () => {
  // Exactly one full page and nothing after it: the second call is what proves
  // the end of the data, not the first.
  const rows = await fetchAllPages<number>(async (from) => {
    const page = Array.from({ length: from === 0 ? PAGE_SIZE : 0 }, (_, i) => i);
    return { data: page, error: null };
  });

  assert.equal(rows.length, PAGE_SIZE);
});

test('fetchAllPages throws instead of returning a truncated set', async () => {
  await assert.rejects(
    () =>
      fetchAllPages<number>(async (from) => ({
        data: Array.from({ length: PAGE_SIZE }, (_, i) => from + i),
        error: null,
      })),
    /narrow the dates/,
  );
});

test('fetchAllPages surfaces the database error', async () => {
  await assert.rejects(
    () => fetchAllPages<number>(async () => ({ data: null, error: { message: 'boom' } })),
    /boom/,
  );
});

test('a query that never returns rows is not a paging loop', async () => {
  const rows = await fetchAllPages<number>(async () => ({ data: [], error: null }));
  assert.deepEqual(rows, []);
  assert.ok(MAX_PAGES > 1);
});

test('mergeLegacyRows collapses a split night shift into one day', () => {
  const merged = mergeLegacyRows([
    row({
      pin: 'E1',
      punch_date: '2026-09-01',
      check_in: '2026-09-01T21:00:00Z',
      check_out: '2026-09-01T23:00:00Z',
      total_punches: 1,
      device_name: null,
    }),
    row({
      pin: 'E1',
      punch_date: '2026-09-01',
      check_in: '2026-09-02T05:00:00Z',
      check_out: '2026-09-02T06:30:00Z',
      total_punches: 1,
      device_name: 'Gate 2',
    }),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].check_in, '2026-09-01T21:00:00Z');
  assert.equal(merged[0].check_out, '2026-09-02T06:30:00Z');
  assert.equal(merged[0].total_punches, 2);
  assert.equal(merged[0].device_name, 'Gate 2');
});

test('the engine wins on figures but the legacy device name survives', () => {
  const legacy = [
    row({
      pin: 'E1',
      punch_date: '2026-09-01',
      check_in: '2026-09-01T08:00:00Z',
      check_out: '2026-09-01T16:00:00Z',
      device_name: 'Gate 1',
      full_name: 'Amina',
    }),
    row({ pin: 'E2', punch_date: '2026-09-02', check_in: '2026-09-02T08:00:00Z' }),
  ];

  const engine = [
    row({
      pin: 'E1',
      punch_date: '2026-09-01',
      check_in: '2026-09-01T08:10:00Z',
      check_out: '2026-09-01T16:05:00Z',
      status: 'late',
      expected_minutes: 480,
      worked_minutes: 475,
      late_minutes: 10,
      early_leave_minutes: 0,
      overtime_minutes: 0,
    }),
    // A day with a shift but no punches: the engine has a row, the view does not.
    row({
      pin: 'E3',
      punch_date: '2026-09-01',
      check_in: null,
      check_out: null,
      total_punches: 0,
      status: 'absent',
      expected_minutes: 480,
      worked_minutes: 0,
    }),
  ];

  const { rows, engineKeys, legacyOnlyKeys } = overlayEngineRows(legacy, engine);
  const byKey = new Map(rows.map((r) => [rowKey(r.pin, r.punch_date), r]));

  assert.equal(rows.length, 3, 'unions the two sources instead of picking one');
  assert.equal(engineKeys.length, 2);
  assert.deepEqual(legacyOnlyKeys, ['E2|2026-09-02']);

  const e1 = byKey.get('E1|2026-09-01')!;
  assert.equal(e1.late_minutes, 10, 'engine figure wins');
  assert.equal(e1.status, 'late');
  assert.equal(e1.device_name, 'Gate 1', 'legacy-only field is kept');
  assert.equal(e1.full_name, 'Amina');

  assert.equal(byKey.get('E3|2026-09-01')!.status, 'absent');
  assert.equal(byKey.get('E2|2026-09-02')!.status, undefined);
});

test('sortRows orders by date then PIN numerically', () => {
  const sorted = sortRows([
    row({ pin: '10', punch_date: '2026-09-02' }),
    row({ pin: '9', punch_date: '2026-09-02' }),
    row({ pin: '9', punch_date: '2026-09-01' }),
  ]);

  assert.deepEqual(
    sorted.map((r) => `${r.punch_date}|${r.pin}`),
    ['2026-09-01|9', '2026-09-02|9', '2026-09-02|10'],
  );
});

test('shiftMinutes reads an overnight window as its true length', () => {
  assert.equal(shiftMinutes('08:00:00', '16:00:00'), 480);
  assert.equal(shiftMinutes('21:00:00', '05:00:00'), 480);
  assert.equal(shiftMinutes(null, '05:00:00'), 0);
});

test('legacyRowToDay derives the day from the punch pair and the shift', () => {
  const day = legacyRowToDay(
    row({
      pin: 'E1',
      punch_date: '2026-09-01',
      check_in: '2026-09-01T08:15:00Z',
      check_out: '2026-09-01T17:30:00Z',
      shift_start: '08:00:00',
      shift_end: '17:00:00',
      total_punches: 2,
    }),
  );

  assert.equal(day.status, 'late');
  assert.equal(day.worked_minutes, 555);
  assert.equal(day.expected_minutes, 540);
  assert.equal(day.late_minutes, 15);
  assert.equal(day.overtime_minutes, 15);
});

test('legacyRowToDay claims no lateness when there is no shift to compare to', () => {
  const day = legacyRowToDay(
    row({
      pin: 'E1',
      punch_date: '2026-09-01',
      check_in: '2026-09-01T08:15:00Z',
      check_out: '2026-09-01T17:30:00Z',
      total_punches: 2,
    }),
  );

  assert.equal(day.late_minutes, 0, 'no shift means lateness is unknowable');
  assert.equal(day.overtime_minutes, 0, 'and so is overtime');
  assert.equal(day.status, 'present');
});

test('legacyRowToDay flags a single-punch day as incomplete', () => {
  const day = legacyRowToDay(
    row({
      pin: 'E1',
      punch_date: '2026-09-01',
      check_in: '2026-09-01T08:00:00Z',
      check_out: '2026-09-01T08:00:00Z',
      total_punches: 1,
    }),
  );

  assert.equal(day.status, 'incomplete');
  assert.equal(day.worked_minutes, 0);
});
