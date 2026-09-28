/**
 * Attendance rule engine — pure, no I/O.
 *
 * This is the piece that replaces the old `MIN(timestamp)` / `MAX(timestamp)`
 * view. It is deliberately dependency-free and deterministic so it can be unit
 * tested in isolation; the database plumbing lives in `recompute.ts`.
 *
 * ## Time convention (important)
 *
 * The whole application treats the **UTC components** of a stored timestamp as
 * the device's local wall clock: a terminal in Riyadh (UTC+3) sending "09:00"
 * is stored as `09:00Z` and displayed with `getUTCHours()`. That is what
 * `formatPunchTime` does and what `DATE(timestamp)` did in the old view, so the
 * engine follows the same convention. There is no timezone math here beyond
 * that: `work_date` is a plain calendar date and "minutes" are minutes past
 * that date's UTC midnight.
 *
 * See PRODUCTION_READINESS.md H8 — this is still an implicit assumption, but at
 * least it is now stated in one place.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A calendar date in `YYYY-MM-DD`. */
export type DateKey = string;

export type AttendanceDayStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'leave'
  | 'holiday'
  | 'off'
  | 'incomplete';

/** One segment of a shift, e.g. 22:00 → 06:00 (next day, so `dayOffset` 1). */
export interface ShiftPeriod {
  seq: number;
  /** `HH:MM` or `HH:MM:SS`. */
  startTime: string;
  /** `HH:MM` or `HH:MM:SS`. */
  endTime: string;
  /** 0 = ends the same day, 1 = ends the next day. */
  dayOffset: number;
}

export interface ExpectedShift {
  shiftId: string;
  name?: string | null;
  periods: ShiftPeriod[];
}

export interface AttendancePolicy {
  id?: string | null;
  name?: string | null;
  graceInMinutes: number;
  graceOutMinutes: number;
  minMinutesForFullDay: number;
  /** ISO weekday numbers, 0 = Sunday … 6 = Saturday. */
  weekendDays: number[];
  overtimeAfterMinutes: number;
  requiresOvertimeApproval: boolean;
}

export interface HolidayInfo {
  date: DateKey;
  name?: string | null;
  scope?: string;
  isWorkingDay: boolean;
}

export interface LeaveInfo {
  isOnLeave: boolean;
  type?: string | null;
}

export const DEFAULT_POLICY: AttendancePolicy = {
  id: null,
  name: 'Default',
  graceInMinutes: 0,
  graceOutMinutes: 0,
  minMinutesForFullDay: 480,
  // Friday + Saturday — the Saudi weekend.
  weekendDays: [5, 6],
  overtimeAfterMinutes: 0,
  requiresOvertimeApproval: false,
};

// ---------------------------------------------------------------------------
// Time / date helpers
// ---------------------------------------------------------------------------

export const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `"HH:MM"` / `"HH:MM:SS"` → minutes past midnight. */
export function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(':');
  const hours = Number(h);
  const minutes = Number(m ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

/** The `YYYY-MM-DD` (UTC) calendar date of an ISO timestamp. */
export function toDateKey(iso: string): DateKey {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Minutes past UTC midnight of an ISO timestamp. */
export function wallMinutes(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function addDays(dateKey: DateKey, delta: number): DateKey {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `b` to `a` (`a` later ⇒ positive). */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / MS_PER_DAY);
}

/** ISO weekday of a date key: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateKey: DateKey): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

// ---------------------------------------------------------------------------
// Shift period geometry
// ---------------------------------------------------------------------------

export interface PeriodBounds {
  seq: number;
  /** Minutes past the work date's midnight at which the period starts. */
  startAbs: number;
  /** Minutes past the work date's midnight at which the period ends (may exceed 1440). */
  endAbs: number;
}

/**
 * Resolve absolute minute bounds for a period relative to its work date.
 * A period whose end is at/before its start is treated as crossing midnight
 * even if `dayOffset` was not set (this is how the legacy flat shifts behaved).
 */
export function periodBounds(period: ShiftPeriod): PeriodBounds {
  const startAbs = parseTimeToMinutes(period.startTime);
  let endAbs = parseTimeToMinutes(period.endTime) + (period.dayOffset >= 1 ? MINUTES_PER_DAY : 0);
  if (endAbs <= startAbs) endAbs += MINUTES_PER_DAY;
  return { seq: period.seq, startAbs, endAbs };
}

export interface ShiftWindow {
  startAbs: number;
  endAbs: number;
}

/** Overall covered window of a shift: earliest period start → latest period end. */
export function shiftWindow(periods: ShiftPeriod[]): ShiftWindow | null {
  if (!periods.length) return null;
  let startAbs = Number.POSITIVE_INFINITY;
  let endAbs = Number.NEGATIVE_INFINITY;
  for (const period of periods) {
    const bounds = periodBounds(period);
    startAbs = Math.min(startAbs, bounds.startAbs);
    endAbs = Math.max(endAbs, bounds.endAbs);
  }
  return Number.isFinite(startAbs) ? { startAbs, endAbs } : null;
}

// ---------------------------------------------------------------------------
// Work-date resolution (the cross-midnight fix)
// ---------------------------------------------------------------------------

export interface WorkDateResolution {
  workDate: DateKey;
  /** Punch position in minutes relative to `workDate`'s midnight. */
  minutesFromStart: number;
  /** 0 when the punch falls inside the shift window, otherwise the gap in minutes. */
  distance: number;
}

/**
 * Attribute one punch to the work date it belongs to.
 *
 * A 22:00→06:00 shift has one window per work date, spanning `[22:00, 06:00+1d]`.
 * A 02:00 punch sits inside the *previous* day's window, so it resolves to the
 * previous day's work date — which is why a night shift now produces one row
 * instead of two. When a punch lands outside every window the nearest one wins,
 * so early arrivals and late departures still attach sensibly.
 */
export function resolveWorkDate(
  iso: string,
  periods: ShiftPeriod[],
  options: { slackMinutes?: number } = {},
): WorkDateResolution {
  const key = toDateKey(iso);
  const wall = wallMinutes(iso);
  const window = shiftWindow(periods);

  if (!window) {
    // No rostered shift: the punch's own calendar day is the work date.
    return { workDate: key, minutesFromStart: wall, distance: 0 };
  }

  const slack = options.slackMinutes ?? 0;
  let best: WorkDateResolution | null = null;
  let bestAbsDelta = Infinity;

  // A shift window cannot exceed roughly a day, so only the punch's own day and
  // its two neighbours can own it.
  for (const delta of [0, -1, 1]) {
    const candidate = addDays(key, delta);
    const punchAbs = wall - delta * MINUTES_PER_DAY;
    const inside =
      punchAbs >= window.startAbs - slack && punchAbs <= window.endAbs + slack;
    const distance = inside
      ? 0
      : Math.min(Math.abs(punchAbs - window.startAbs), Math.abs(punchAbs - window.endAbs));

    const better =
      best === null ||
      distance < best.distance ||
      (distance === best.distance && Math.abs(delta) < bestAbsDelta);

    if (better) {
      best = { workDate: candidate, minutesFromStart: punchAbs, distance };
      bestAbsDelta = Math.abs(delta);
    }
  }

  return best as WorkDateResolution;
}

/**
 * Bucket a set of punches by work date for one shift.
 * Punches are returned per date, each list sorted ascending.
 */
export function groupPunchesByWorkDate(
  punches: string[],
  periods: ShiftPeriod[],
): Map<DateKey, string[]> {
  const groups = new Map<DateKey, string[]>();
  for (const iso of punches) {
    const { workDate } = resolveWorkDate(iso, periods);
    const bucket = groups.get(workDate);
    if (bucket) bucket.push(iso);
    else groups.set(workDate, [iso]);
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => Date.parse(a) - Date.parse(b));
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Day evaluation
// ---------------------------------------------------------------------------

export interface EvaluateDayInput {
  workDate: DateKey;
  /** Punches already attributed to this work date (any order). */
  punches: string[];
  shift: ExpectedShift | null;
  policy: AttendancePolicy;
  holiday?: HolidayInfo | null;
  leave?: LeaveInfo | null;
}

export interface EvaluatedDay {
  workDate: DateKey;
  shiftId: string | null;
  policyId: string | null;
  status: AttendanceDayStatus;
  expectedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
  punchCount: number;
  /** True when the worked time meets `minMinutesForFullDay`. */
  countsFullDay: boolean;
}

/**
 * Evaluate one (employee, work_date) pair. Pure: same input ⇒ same output.
 *
 * Rules applied, in order:
 *  - approved leave ⇒ `leave`; non-working holiday ⇒ `holiday`; weekend ⇒ `off`.
 *  - a rostered working day with no punches ⇒ `absent`.
 *  - a day with a single punch (or a period with a single punch) ⇒ `incomplete`.
 *  - late / early-leave are measured against the first / last period, net of
 *    the policy grace periods.
 *  - overtime is time worked beyond the expected shift (or beyond zero on a rest
 *    day / holiday) once `overtimeAfterMinutes` is exceeded.
 */
export function evaluateDay(input: EvaluateDayInput): EvaluatedDay {
  const { workDate, policy } = input;
  const shift = input.shift && input.shift.periods.length > 0 ? input.shift : null;
  const leave = input.leave ?? null;
  const onLeave = !!leave?.isOnLeave;
  const holiday = input.holiday ?? null;
  const isHoliday = !!holiday && !holiday.isWorkingDay;
  const isWeekend = policy.weekendDays.includes(weekdayOf(workDate));

  const punches = [...input.punches].sort((a, b) => Date.parse(a) - Date.parse(b));
  const punchCount = punches.length;

  const periods = shift ? shift.periods.map((period) => ({ ...periodBounds(period) })) : [];
  const scheduledMinutes = periods.reduce(
    (sum, p) => sum + Math.max(0, p.endAbs - p.startAbs),
    0,
  );
  // Nobody is *expected* to work on a weekend or a non-working holiday, so the
  // expected figure is zero there. Leave keeps the obligation on the row (the
  // person is excused, not un-rostered) but owes no overtime for it.
  const expectedMinutes = isWeekend || isHoliday ? 0 : scheduledMinutes;

  // Position of every punch relative to this work date's midnight.
  const relative = punches.map((iso) => ({
    iso,
    abs: wallMinutes(iso) + MINUTES_PER_DAY * diffDays(toDateKey(iso), workDate),
  }));

  let workedMinutes = 0;
  let incomplete = false;
  let firstPunchAbs: number | null = null;
  let lastPunchAbs: number | null = null;

  if (periods.length === 0) {
    // No rostered shift: measure the span of the day's punches.
    if (relative.length >= 2) {
      firstPunchAbs = relative[0].abs;
      lastPunchAbs = relative[relative.length - 1].abs;
      workedMinutes = Math.max(0, lastPunchAbs - firstPunchAbs);
    } else if (relative.length === 1) {
      incomplete = true;
    }
  } else {
    // Assign each punch to the nearest period on this work date.
    const buckets = periods.map((p) => ({ period: p, punches: relative.slice(0, 0) }));
    for (const punch of relative) {
      let target = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < periods.length; i += 1) {
        const p = periods[i];
        const inside = punch.abs >= p.startAbs && punch.abs <= p.endAbs;
        const distance = inside
          ? 0
          : Math.min(Math.abs(punch.abs - p.startAbs), Math.abs(punch.abs - p.endAbs));
        if (distance < bestDistance) {
          bestDistance = distance;
          target = i;
        }
      }
      buckets[target].punches.push(punch);
    }

    for (const bucket of buckets) {
      const list = bucket.punches;
      if (list.length === 0) continue;
      if (list.length === 1) {
        incomplete = true;
      } else {
        workedMinutes += Math.max(0, list[list.length - 1].abs - list[0].abs);
      }
      const first = list[0].abs;
      const last = list[list.length - 1].abs;
      if (firstPunchAbs === null || first < firstPunchAbs) firstPunchAbs = first;
      if (lastPunchAbs === null || last > lastPunchAbs) lastPunchAbs = last;
    }
    if (punchCount === 1) incomplete = true;
  }

  const workingDay = !onLeave && !isHoliday && !isWeekend;

  // Late / early-leave are only meaningful on a normal working day with a shift.
  let lateMinutes = 0;
  if (workingDay && periods.length > 0 && firstPunchAbs !== null) {
    const firstPeriodStart = periods[0].startAbs;
    lateMinutes = Math.max(0, firstPunchAbs - firstPeriodStart - policy.graceInMinutes);
  }

  let earlyLeaveMinutes = 0;
  if (workingDay && periods.length > 0 && punchCount >= 2 && lastPunchAbs !== null) {
    const lastPeriodEnd = periods[periods.length - 1].endAbs;
    earlyLeaveMinutes = Math.max(0, lastPeriodEnd - lastPunchAbs - policy.graceOutMinutes);
  }

  // Overtime: worked time beyond the expected shift (all worked time on a rest
  // day or holiday is overtime, since the expected figure there is zero).
  const expectedForOvertime = onLeave ? 0 : expectedMinutes;
  const overtimeThreshold = expectedForOvertime + policy.overtimeAfterMinutes;
  const overtimeMinutes =
    !incomplete && workedMinutes > overtimeThreshold
      ? workedMinutes - expectedForOvertime
      : 0;

  let status: AttendanceDayStatus;
  if (onLeave) {
    status = 'leave';
  } else if (isHoliday) {
    status = 'holiday';
  } else if (isWeekend) {
    status = 'off';
  } else if (punchCount === 0) {
    status = shift ? 'absent' : 'off';
  } else if (incomplete) {
    status = 'incomplete';
  } else if (lateMinutes > 0) {
    status = 'late';
  } else {
    status = 'present';
  }

  return {
    workDate,
    shiftId: shift?.shiftId ?? null,
    policyId: policy.id ?? null,
    status,
    expectedMinutes,
    workedMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    firstIn: punchCount > 0 ? punches[0] : null,
    lastOut: punchCount >= 2 ? punches[punches.length - 1] : null,
    punchCount,
    countsFullDay: workedMinutes >= policy.minMinutesForFullDay,
  };
}

/** Statuses a payroll clerk must act on rather than skim past. */
export const EXCEPTION_STATUSES: AttendanceDayStatus[] = [
  'late',
  'absent',
  'incomplete',
];

export function isExceptionDay(day: {
  status: AttendanceDayStatus;
  earlyLeaveMinutes?: number;
}): boolean {
  return EXCEPTION_STATUSES.includes(day.status) || (day.earlyLeaveMinutes ?? 0) > 0;
}
