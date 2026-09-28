-- =============================================
-- Phase 7 — Self-service (additive migration)
-- Run after `phase4_roles_audit.sql`.
--
-- Two small additions make the employee-facing surface possible:
--   1. `profiles.employee_pin` links a signed-in user to their roster row. Only
--      an owner sets it, and it is the ONLY thing that decides which attendance
--      an employee may see: the API resolves the pin from the session, never
--      from a request parameter.
--   2. `punch_change_requests` gains `source` and `note`. A correction an
--      employee submits for themselves is the same table and the same approval
--      path as an operator's queued punch edit — it just arrives labelled
--      `self_service`, so the existing approvals inbox shows it with context.
--
-- Deliberately NOT done here: a separate `correction_requests` table. A
-- correction IS a punch change; duplicating the workflow would mean two
-- approval screens and two code paths that must not diverge.
--
-- No new RLS policy is required. Employees write nothing directly: the
-- self-service routes run with the service role and enforce "you may only
-- request for the pin on your own profile" in the handler.
--
-- Idempotent: safe to run more than once.
-- =============================================

-- ----------------------------------------------------------------------------
-- 1. Link an auth user to an employee
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_pin VARCHAR(255);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'profiles_employee_pin_fkey'
          AND table_name = 'profiles'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_employee_pin_fkey
            FOREIGN KEY (employee_pin) REFERENCES public.employees(pin) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_employee_pin
    ON public.profiles(employee_pin);

-- ----------------------------------------------------------------------------
-- 2. Classify punch-change requests
-- ----------------------------------------------------------------------------
ALTER TABLE public.punch_change_requests
    ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'operator';

ALTER TABLE public.punch_change_requests
    ADD COLUMN IF NOT EXISTS note TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'punch_change_requests_source_check'
          AND conrelid = 'public.punch_change_requests'::regclass
    ) THEN
        ALTER TABLE public.punch_change_requests
            ADD CONSTRAINT punch_change_requests_source_check
            CHECK (source IN ('operator', 'self_service'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_punch_change_requests_source
    ON public.punch_change_requests(source, status, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Verification
-- ----------------------------------------------------------------------------
-- select count(*) from public.profiles where employee_pin is not null;
-- select source, status, count(*) from public.punch_change_requests group by source, status;
-- select column_name, data_type from information_schema.columns
--   where table_name = 'punch_change_requests' order by ordinal_position;
