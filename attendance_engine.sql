-- =============================================
-- Phase 1 — Attendance rule engine (additive migration)
-- Run this in the Supabase SQL Editor AFTER `secure_rls.sql`.
--
-- What this file does (and, deliberately, what it does NOT do)
-- ------------------------------------------------------------
-- It creates the tables the rule engine needs and BACKFILLS them from the
-- existing `shifts` / `employee_shifts` data so nothing has to be re-entered:
--
--   attendance_policies          one row per rule set (grace, weekend, overtime…)
--   shift_periods                a shift is now 1..3 periods, each with a day offset
--   employee_shift_assignments   effective-dated roster (replaces UNIQUE(pin))
--   holidays                     date + scope calendar
--   attendance_days              the computed day summary (one row per pin + work_date)
--
-- It does NOT touch the live `daily_attendance_summary` view. The application
-- reads `attendance_days` directly and falls back to the legacy view while the
-- table is still empty, so deploying this file is safe in any order. Once the
-- backfill has run and been spot-checked, run `attendance_engine_switch_view.sql`
-- to point the legacy view (and therefore the Excel/PDF exports) at the engine.
--
-- Why the old view was wrong: it grouped by `DATE(timestamp)` and took
-- MIN/MAX of the day's punches. A 22:00→06:00 night shift therefore produced
-- two rows for one worked shift (one for each side of midnight) and no concept
-- of late / early-leave / absent / overtime existed anywhere. See
-- BIOTIME_PARITY.md §3.2.
--
-- This file is idempotent: run it as many times as you like.
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Attendance policies (rule sets)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_policies (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    -- Arriving up to N minutes after the period start is not "late".
    grace_in_minutes INTEGER NOT NULL DEFAULT 0,
    -- Leaving up to N minutes before the period end is not "early leave".
    grace_out_minutes INTEGER NOT NULL DEFAULT 0,
    -- Worked minutes needed to count as a full day (used by reports/Phase 3).
    min_minutes_for_full_day INTEGER NOT NULL DEFAULT 480,
    -- ISO weekday numbers: 0 = Sunday … 6 = Saturday. Fri/Sat in Saudi Arabia.
    weekend_days INTEGER[] NOT NULL DEFAULT '{5,6}',
    -- Minutes past the expected shift that must be worked before it is overtime.
    overtime_after_minutes INTEGER NOT NULL DEFAULT 0,
    requires_overtime_approval BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Only one default policy may exist at a time.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_policies_single_default
    ON public.attendance_policies ((is_default)) WHERE is_default;

INSERT INTO public.attendance_policies (name, is_default)
SELECT 'Default', true
WHERE NOT EXISTS (SELECT 1 FROM public.attendance_policies);

-- ----------------------------------------------------------------------------
-- 2. Shift periods — a shift template becomes 1..3 periods, each able to end
--    on the following day (day_offset = 1). `shifts.start_time/end_time` stay
--    as the period-1 projection for backward compatibility.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shift_periods (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL DEFAULT 1 CHECK (seq BETWEEN 1 AND 3),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    -- 0 = ends the same day, 1 = ends the next day.
    day_offset INTEGER NOT NULL DEFAULT 0 CHECK (day_offset IN (0, 1)),
    crosses_midnight BOOLEAN GENERATED ALWAYS AS
        (day_offset = 1 OR end_time <= start_time) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (shift_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_shift_periods_shift ON public.shift_periods(shift_id, seq);

-- Backfill: every existing shift becomes a single period. A shift whose end is
-- at/ before its start already crossed midnight in the UI, so it gets offset 1.
INSERT INTO public.shift_periods (shift_id, seq, start_time, end_time, day_offset)
SELECT s.id, 1, s.start_time, s.end_time,
       CASE WHEN s.end_time <= s.start_time THEN 1 ELSE 0 END
FROM public.shifts s
WHERE NOT EXISTS (
    SELECT 1 FROM public.shift_periods sp WHERE sp.shift_id = s.id
);

-- ----------------------------------------------------------------------------
-- 3. Employee shift assignments — effective-dated, so history and future
--    rosters work. The legacy `employee_shifts` (UNIQUE(pin)) is kept as a
--    fallback source until the roster UI is migrated.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_shift_assignments (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) NOT NULL REFERENCES public.employees(pin) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_emp_shift_assign_pin
    ON public.employee_shift_assignments(pin, effective_from DESC);
-- One open-ended assignment per pin at a time is enforced in code; a plain
-- unique index would forbid re-assigning a shift on the same date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_shift_assign_pin_from
    ON public.employee_shift_assignments(pin, effective_from);

-- Backfill from the legacy one-shift-per-person table. The far-past date makes
-- the imported row valid for all history.
INSERT INTO public.employee_shift_assignments (pin, shift_id, effective_from)
SELECT es.pin, es.shift_id, DATE '2000-01-01'
FROM public.employee_shifts es
WHERE NOT EXISTS (
    SELECT 1 FROM public.employee_shift_assignments a
    WHERE a.pin = es.pin AND a.effective_from = DATE '2000-01-01'
);

-- ----------------------------------------------------------------------------
-- 4. Holidays — scope is 'all' or a branch name. is_working_day=false means a
--    day off that is NOT an absence; work done on it is overtime.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.holidays (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    date DATE NOT NULL,
    name VARCHAR(255) NOT NULL,
    scope VARCHAR(255) NOT NULL DEFAULT 'all',
    is_working_day BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (date, scope)
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON public.holidays(date);

-- ----------------------------------------------------------------------------
-- 5. attendance_days — the computed summary, one row per pin + work_date.
--    `work_date` is the SHIFT DAY a punch belongs to, not the calendar day of
--    the timestamp, which is what fixes the cross-midnight split.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_days (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) NOT NULL REFERENCES public.employees(pin) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
    policy_id UUID REFERENCES public.attendance_policies(id) ON DELETE SET NULL,
    expected_minutes INTEGER NOT NULL DEFAULT 0,
    worked_minutes INTEGER NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    early_leave_minutes INTEGER NOT NULL DEFAULT 0,
    overtime_minutes INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'present'
        CHECK (status IN ('present','late','absent','leave','holiday','off','incomplete')),
    first_in TIMESTAMPTZ,
    last_out TIMESTAMPTZ,
    punch_count INTEGER NOT NULL DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pin, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_days_work_date
    ON public.attendance_days(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_days_pin
    ON public.attendance_days(pin, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_days_status
    ON public.attendance_days(status);

-- ----------------------------------------------------------------------------
-- 6. Row Level Security — same posture as the rest of the schema: authenticated
--    users get full access (there is still one role until Phase 4), `anon` gets
--    nothing, and the ingestion path keeps using the service role.
-- ----------------------------------------------------------------------------
ALTER TABLE public.attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'attendance_policies', 'shift_periods', 'employee_shift_assignments',
        'holidays', 'attendance_days'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_full_access', target_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
            'authenticated_full_access', target_table
        );
    END LOOP;
END $$;

REVOKE ALL ON public.attendance_policies FROM anon;
REVOKE ALL ON public.shift_periods FROM anon;
REVOKE ALL ON public.employee_shift_assignments FROM anon;
REVOKE ALL ON public.holidays FROM anon;
REVOKE ALL ON public.attendance_days FROM anon;

GRANT ALL ON public.attendance_policies TO authenticated, service_role, postgres;
GRANT ALL ON public.shift_periods TO authenticated, service_role, postgres;
GRANT ALL ON public.employee_shift_assignments TO authenticated, service_role, postgres;
GRANT ALL ON public.holidays TO authenticated, service_role, postgres;
GRANT ALL ON public.attendance_days TO authenticated, service_role, postgres;

-- ----------------------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------------------
-- select name, is_default from public.attendance_policies;
-- select s.name, sp.seq, sp.start_time, sp.end_time, sp.day_offset, sp.crosses_midnight
--   from public.shifts s join public.shift_periods sp on sp.shift_id = s.id order by s.name, sp.seq;
-- select count(*) as assignments from public.employee_shift_assignments;
-- select count(*) as computed_days from public.attendance_days;
