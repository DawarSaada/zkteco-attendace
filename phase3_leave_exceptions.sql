-- =============================================
-- Phase 3 — Leave, holidays and exceptions (additive migration)
-- Run after `attendance_engine.sql`.
--
-- Adds:
--   leave_types            paid / accrual / approval rules per leave kind,
--   leave_requests         the request + decision record,
--   leave_balances         entitlement per employee / type / year,
--   punch_change_requests  a pending edit for a non-admin actor (pairs with Phase 4),
--   exceptions             the punch-level exception inbox.
--
-- `holidays` already exists (Phase 1) — this file only widens its use.
--
-- `leave_balances.used` is deliberately NOT stored: it is derived from approved
-- requests so it can never drift out of sync with the decision history.
--
-- Idempotent: safe to run more than once.
-- =============================================

-- ----------------------------------------------------------------------------
-- 1. Leave types
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_types (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    paid BOOLEAN NOT NULL DEFAULT true,
    requires_approval BOOLEAN NOT NULL DEFAULT true,
    -- Days per year granted by default; 0 means "set per employee".
    accrual_per_year NUMERIC(6,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.leave_types (name, paid, accrual_per_year)
VALUES
    ('Annual', true, 21),
    ('Sick', true, 30),
    ('Unpaid', false, 0),
    ('Emergency', true, 5)
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Leave requests (the request + its decision)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) NOT NULL REFERENCES public.employees(pin) ON DELETE CASCADE,
    type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    note TEXT,
    requested_by UUID,
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_pin
    ON public.leave_requests(pin, from_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status
    ON public.leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_range
    ON public.leave_requests(from_date, to_date) WHERE status = 'approved';

-- ----------------------------------------------------------------------------
-- 3. Leave balances — entitlement only; `used` is derived from approved requests.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_balances (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) NOT NULL REFERENCES public.employees(pin) ON DELETE CASCADE,
    type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    entitled_days NUMERIC(6,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (pin, type_id, year)
);

-- ----------------------------------------------------------------------------
-- 4. Punch change requests — a manual punch edit by a non-admin becomes pending
--    until an owner/admin approves it. Admin edits are applied immediately and
--    only recorded for approval when made through this flow (Phase 4 decides who
--    must use it).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.punch_change_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) NOT NULL REFERENCES public.employees(pin) ON DELETE CASCADE,
    work_date DATE,
    action VARCHAR(16) NOT NULL CHECK (action IN ('add', 'edit', 'delete')),
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by UUID,
    decided_by UUID,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_punch_change_requests_status
    ON public.punch_change_requests(status, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. Exceptions — one row per (employee, work date, kind). Generated from the
--    engine for incomplete days and resolvable by an HR clerk.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exceptions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) NOT NULL REFERENCES public.employees(pin) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    kind VARCHAR(32) NOT NULL
        CHECK (kind IN ('missing_check_out', 'missing_check_in', 'duplicate', 'unmatched_device', 'other')),
    state VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (state IN ('open', 'resolved', 'ignored')),
    reason_code VARCHAR(64),
    note TEXT,
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (pin, work_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_exceptions_open
    ON public.exceptions(state, work_date DESC);

-- ----------------------------------------------------------------------------
-- 6. RLS + grants
-- ----------------------------------------------------------------------------
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punch_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exceptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'leave_types', 'leave_requests', 'leave_balances', 'punch_change_requests', 'exceptions'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_full_access', target_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
            'authenticated_full_access', target_table
        );
    END LOOP;
END $$;

REVOKE ALL ON public.leave_types FROM anon;
REVOKE ALL ON public.leave_requests FROM anon;
REVOKE ALL ON public.leave_balances FROM anon;
REVOKE ALL ON public.punch_change_requests FROM anon;
REVOKE ALL ON public.exceptions FROM anon;

GRANT ALL ON public.leave_types TO authenticated, service_role, postgres;
GRANT ALL ON public.leave_requests TO authenticated, service_role, postgres;
GRANT ALL ON public.leave_balances TO authenticated, service_role, postgres;
GRANT ALL ON public.punch_change_requests TO authenticated, service_role, postgres;
GRANT ALL ON public.exceptions TO authenticated, service_role, postgres;

-- ----------------------------------------------------------------------------
-- 7. Verification
-- ----------------------------------------------------------------------------
-- select name, paid, accrual_per_year from public.leave_types order by name;
-- select status, count(*) from public.leave_requests group by status;
-- select kind, state, count(*) from public.exceptions group by kind, state;
