-- =============================================
-- Phase 4 — Roles, permissions and audit (additive migration)
-- Run last, after every other migration.
--
-- Before this file, EVERY authenticated user could read and write everything:
-- a single `authenticated_full_access` policy per table (see `secure_rls.sql`).
-- This file:
--   1. adds `profiles` (role + branch scope per auth user),
--   2. adds role helper functions the policies are written against,
--   3. replaces the blanket policies with per-command policies: any signed-in
--      user may READ, only owner/admin may WRITE,
--   4. adds an append-only `audit_log`.
--
-- BOOTSTRAP (important): while `profiles` is EMPTY the application promotes the
-- first signed-in user to `owner` and writes their profile. That user then
-- manages everyone else from /dashboard/users. Until that first sign-in happens,
-- a signed-in user is treated as owner by the app — the same behaviour as before
-- this migration — so deploying this file cannot lock the owner out.
--
-- Deliberately NOT done here: read scoping by `branch_scope`. Every reporting
-- table would need a non-null `branch` column and the reporting views would have
-- to be reworked; `attendance_logs` has no branch at all. The column and the
-- helper function are in place so this can be completed without another schema
-- change; see PRODUCTION_READINESS.md §15.
--
-- Idempotent: safe to run more than once.
-- =============================================

-- ----------------------------------------------------------------------------
-- 1. Profiles
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'viewer'
        CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
    -- Empty means "every branch".
    branch_scope TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. Role helpers. SECURITY DEFINER so a policy can read `profiles` without
--    recursing into the caller's own RLS.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT role FROM public.profiles WHERE user_id = auth.uid()), 'viewer')
$$;

CREATE OR REPLACE FUNCTION public.current_branch_scope()
RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT branch_scope FROM public.profiles WHERE user_id = auth.uid()), '{}'::text[])
$$;

CREATE OR REPLACE FUNCTION public.can_write()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.current_app_role() IN ('owner', 'admin')
$$;

CREATE OR REPLACE FUNCTION public.can_operate()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.current_app_role() IN ('owner', 'admin', 'operator')
$$;

GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_branch_scope() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_operate() TO authenticated, service_role;

-- profiles: readable by any signed-in user (the UI shows who is who); only an
-- owner may change a role.
DROP POLICY IF EXISTS authenticated_full_access ON public.profiles;
DROP POLICY IF EXISTS profiles_read ON public.profiles;
DROP POLICY IF EXISTS profiles_write ON public.profiles;

CREATE POLICY profiles_read ON public.profiles
    FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY profiles_write ON public.profiles
    FOR ALL TO authenticated
    USING (public.current_app_role() = 'owner')
    WITH CHECK (public.current_app_role() = 'owner');

-- ----------------------------------------------------------------------------
-- 3. Audit log — append-only by construction: there is no UPDATE or DELETE
--    policy, so even an owner cannot rewrite history through the API.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    actor UUID,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    before JSONB,
    after JSONB,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON public.audit_log(at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity, at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_full_access ON public.audit_log;
DROP POLICY IF EXISTS audit_log_read ON public.audit_log;
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;

CREATE POLICY audit_log_read ON public.audit_log
    FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Any signed-in user may append (so an attempted action can be recorded);
-- nobody may rewrite or remove.
CREATE POLICY audit_log_insert ON public.audit_log
    FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

GRANT ALL ON public.profiles TO authenticated, service_role, postgres;
GRANT ALL ON public.audit_log TO authenticated, service_role, postgres;
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.audit_log FROM anon;

-- ----------------------------------------------------------------------------
-- 4. Replace the blanket policy on every business table with read-for-all /
--    write-for-admin. Two permissive policies OR together per command, so a
--    viewer keeps SELECT from `<table>_read` and is denied by `<table>_write`.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'devices', 'employees', 'attendance_logs', 'device_commands',
        'shifts', 'employee_shifts', 'report_automations', 'report_automation_logs',
        'attendance_policies', 'shift_periods', 'employee_shift_assignments',
        'holidays', 'attendance_days', 'device_users', 'device_settings',
        'leave_types', 'leave_requests', 'leave_balances',
        'punch_change_requests', 'exceptions'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_full_access', target_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target_table || '_read', target_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', target_table || '_write', target_table);

        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL)',
            target_table || '_read', target_table
        );
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write())',
            target_table || '_write', target_table
        );
    END LOOP;
END $$;

-- Biometric templates are sensitive personal data: no read policy for
-- non-writers, so only owner/admin see them at all.
DROP POLICY IF EXISTS authenticated_full_access ON public.biometric_templates;
DROP POLICY IF EXISTS biometric_templates_admin ON public.biometric_templates;
CREATE POLICY biometric_templates_admin ON public.biometric_templates
    FOR ALL TO authenticated
    USING (public.can_write())
    WITH CHECK (public.can_write());

-- ----------------------------------------------------------------------------
-- 5. Verification
-- ----------------------------------------------------------------------------
-- select role, count(*) from public.profiles group by role;
-- select policyname, cmd from pg_policies where schemaname='public' and tablename='attendance_logs' order by policyname;
--   → attendance_logs_read (SELECT) + attendance_logs_write (ALL, can_write())
-- select count(*) from public.audit_log;
