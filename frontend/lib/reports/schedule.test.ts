import test from 'node:test';
import assert from 'node:assert/strict';
import { isDue, periodFor, saudiNow, type AutomationLike } from './schedule.ts';

/** A Saudi wall-clock reading, built the way the cron derives it. */
function at(dateKey: string, hour: number, minute = 0) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return {
    dateKey,
    dayOfMonth: day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour,
    minute,
  };
}

function rule(overrides: Partial<AutomationLike> = {}): AutomationLike {
  return {
    cadence: 'monthly',
    dispatch_day: 26,
    dispatch_time: '08:00:00',
    cycle_start_day: 26,
    cycle_end_day: 25,
    last_run_at: null,
    ...overrides,
  };
}

test('saudiNow reads the Saudi day, not the UTC one', () => {
  const lateUtc = saudiNow(new Date('2026-09-25T22:30:00Z'));
  assert.equal(lateUtc.dateKey, '2026-09-26');
  assert.equal(lateUtc.dayOfMonth, 26);
  assert.equal(lateUtc.hour, 1);
  assert.equal(lateUtc.minute, 30);

  const morningUtc = saudiNow(new Date('2026-09-25T09:00:00Z'));
  assert.equal(morningUtc.dateKey, '2026-09-25');
  assert.equal(morningUtc.hour, 12);
});

test('before the dispatch hour, nothing is due', () => {
  const early = rule({ dispatch_time: '08:00:00' });
  assert.equal(isDue(early, at('2026-09-26', 7, 59)), false);
  assert.equal(isDue(early, at('2026-09-26', 8, 0)), true);
});

test('a rule already dispatched today is never sent twice', () => {
  // last_run_at 05:00 UTC is 08:00 in Saudi Arabia, same Saudi day.
  const done = rule({ dispatch_time: '08:00:00', last_run_at: '2026-09-26T05:00:00Z' });
  assert.equal(isDue(done, at('2026-09-26', 8)), false);
  assert.equal(isDue(done, at('2026-09-26', 23, 55)), false);
});

test('a rule that last ran yesterday is due again today', () => {
  const yesterday = rule({ cadence: 'daily', last_run_at: '2026-09-25T05:00:00Z' });
  assert.equal(isDue(yesterday, at('2026-09-26', 8)), true);
});

test('an unparseable last_run_at does not block a dispatch', () => {
  const broken = rule({ last_run_at: 'not-a-date' });
  assert.equal(isDue(broken, at('2026-09-26', 8)), true);
});

test('the once-daily cron catches up instead of dropping the period', () => {
  // Hobby allows one run a day; a rule configured for 08:00 must still go out in
  // the 23:55 run rather than being skipped for the whole month.
  const morningRule = rule({ dispatch_time: '08:00:00' });
  assert.equal(isDue(morningRule, at('2026-09-26', 23, 55)), true);

  const eveningRule = rule({ dispatch_time: '20:00:00' });
  assert.equal(isDue(eveningRule, at('2026-09-26', 23, 55)), true);
});

test('catching up does not leak into the next Saudi day', () => {
  const day26 = rule({ dispatch_day: 26 });
  // 02:55 AST on the 27th is a new Saudi day: the 26th has passed and the 27th is
  // not its dispatch day, so a late run must not send the wrong period.
  assert.equal(isDue(day26, at('2026-09-27', 2, 55)), false);
  // The 27th's own rule is due once its own hour has arrived: the catch-up window
  // belongs to the day, it is not a blanket "anything not yet sent".
  assert.equal(
    isDue(rule({ dispatch_day: 27, dispatch_time: '02:00:00' }), at('2026-09-27', 2, 55)),
    true,
  );
});

test('monthly, weekly and daily cadences pick the right day', () => {
  const monthly = rule({ dispatch_day: 26 });
  assert.equal(isDue(monthly, at('2026-09-25', 8)), false);
  assert.equal(isDue(monthly, at('2026-09-26', 8)), true);

  // dispatch_day holds the ISO weekday for weekly rules; 2026-09-28 is a Monday.
  const weekly = rule({ cadence: 'weekly', dispatch_day: 1 });
  assert.equal(isDue(weekly, at('2026-09-28', 8)), true);
  assert.equal(isDue(weekly, at('2026-09-29', 8)), false);

  const daily = rule({ cadence: 'daily' });
  assert.equal(isDue(daily, at('2026-09-29', 8)), true);
});

test('a missing dispatch_time behaves like 08:00', () => {
  const defaulted = rule({ dispatch_time: null });
  assert.equal(isDue(defaulted, at('2026-09-26', 7)), false);
  assert.equal(isDue(defaulted, at('2026-09-26', 8)), true);
});

test('periods cover the window that has just closed', () => {
  assert.deepEqual(periodFor(rule({ cadence: 'daily' }), at('2026-09-26', 8)), {
    from: '2026-09-25',
    to: '2026-09-25',
  });

  assert.deepEqual(periodFor(rule({ cadence: 'weekly' }), at('2026-09-26', 8)), {
    from: '2026-09-19',
    to: '2026-09-25',
  });

  assert.deepEqual(periodFor(rule({ cadence: 'monthly' }), at('2026-09-26', 8)), {
    from: '2026-08-26',
    to: '2026-09-25',
  });
});

test('a custom payroll window is honoured', () => {
  const custom = rule({ cycle_start_day: 1, cycle_end_day: 30 });
  assert.deepEqual(periodFor(custom, at('2026-09-26', 8)), {
    from: '2026-08-01',
    to: '2026-09-30',
  });
});
