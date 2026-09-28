// Relative with the explicit extension on purpose: the tests for this module run
// through `node --test` on the TypeScript sources directly, which resolves
// neither the `@/` alias nor an extensionless specifier.
import { addDays, toDateKey } from '../attendance/engine.ts';

/**
 * Scheduling logic for report automations.
 *
 * The cron asks this module which rules are due, so the `dispatch_time` column
 * the UI has always exposed is finally honoured (M4). Everything here is pure and
 * works on "Saudi wall clock" dates, matching the payroll cycle convention the
 * rest of the app uses (UTC+3, no DST).
 *
 * It has to hold for two very different cron schedules — see `isDue`.
 */

export type Cadence = 'monthly' | 'weekly' | 'daily';

export interface AutomationLike {
  cadence?: string | null;
  dispatch_day?: number | null;
  dispatch_time?: string | null;
  cycle_start_day?: number | null;
  cycle_end_day?: number | null;
  last_run_at?: string | null;
}

export interface SaudiNow {
  /** `YYYY-MM-DD` in Saudi Arabia. */
  dateKey: string;
  dayOfMonth: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** 0–23. */
  hour: number;
  minute: number;
}

/** Derive the Saudi (UTC+3) wall clock from the current instant. */
export function saudiNow(now: Date = new Date()): SaudiNow {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return {
    dateKey: shifted.toISOString().slice(0, 10),
    dayOfMonth: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function parseHour(dispatchTime?: string | null): number {
  if (!dispatchTime) return 8;
  const hour = Number(String(dispatchTime).split(':')[0]);
  return Number.isFinite(hour) ? hour : 8;
}

/**
 * Is this rule due now?
 *
 * Two constraints shape the answer:
 *  - Vercel's Hobby plan allows only a once-daily cron, so the job cannot always
 *    run in the hour a rule asked for. An exact hour match would then skip every
 *    rule whose `dispatch_time` is later than the run — losing that period
 *    outright, which for a payroll report is not an acceptable trade.
 *  - One period must never be sent twice.
 *
 * So a rule becomes due at its preferred hour and stays due for the rest of that
 * Saudi day, and `last_run_at` closes it once it has gone out. With an hourly
 * cron that is exactly the old behaviour (fires in its own hour, later runs skip
 * it); with the once-daily cron it fires in that run instead of being dropped.
 */
export function isDue(rule: AutomationLike, now: SaudiNow): boolean {
  if (now.hour < parseHour(rule.dispatch_time)) return false;

  if (rule.last_run_at) {
    const last = new Date(rule.last_run_at);
    if (!Number.isNaN(last.getTime()) && saudiNow(last).dateKey === now.dateKey) {
      return false;
    }
  }

  switch ((rule.cadence ?? 'monthly') as Cadence) {
    case 'daily':
      return true;
    case 'weekly':
      // dispatch_day holds the ISO weekday for weekly rules.
      return now.weekday === (rule.dispatch_day ?? 0);
    case 'monthly':
    default:
      return now.dayOfMonth === (rule.dispatch_day ?? 26);
  }
}

/** The period a rule should report on, given the current Saudi date. */
export function periodFor(rule: AutomationLike, now: SaudiNow): { from: string; to: string } {
  switch ((rule.cadence ?? 'monthly') as Cadence) {
    case 'daily':
      // The day that just ended.
      return { from: addDays(now.dateKey, -1), to: addDays(now.dateKey, -1) };

    case 'weekly': {
      // The seven days ending yesterday.
      return { from: addDays(now.dateKey, -7), to: addDays(now.dateKey, -1) };
    }

    case 'monthly':
    default: {
      const startDay = rule.cycle_start_day ?? 26;
      const endDay = rule.cycle_end_day ?? 25;
      const currentMonthStart = `${now.dateKey.slice(0, 7)}-01`;
      const previousMonthDate = addDays(currentMonthStart, -1);
      const previousMonth = previousMonthDate.slice(0, 7);

      const from = `${previousMonth}-${String(startDay).padStart(2, '0')}`;
      const to = `${now.dateKey.slice(0, 7)}-${String(endDay).padStart(2, '0')}`;
      return { from, to };
    }
  }
}

/** Convenience for logging a run against a date. */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now.toISOString());
}
