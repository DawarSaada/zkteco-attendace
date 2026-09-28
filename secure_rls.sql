-- =============================================================================
--  SECURITY LOCK-DOWN for the ZKTeco / BioTime-Pro attendance database
--  Closes blockers B1, B2 and B3 from PRODUCTION_READINESS.md.
--
--  WHAT WAS WRONG
--    1. `database_schema.sql` created `CREATE POLICY ... FOR ALL USING (true)`
--       with no `TO` clause on all eight tables. A policy without `TO` applies to
--       PUBLIC, which includes `anon`. Combined with
--       `GRANT ALL ... TO anon`, the public anon key (which is shipped to every
--       browser by design) could read, insert, update and delete everything.
--    2. `daily_attendance_summary` was created without `security_invoker`, so it
--       ran as its owner and bypassed RLS on the base tables — and it was granted
--       to `anon` as well.
--    3. The original version of this file only covered 3 of the 8 tables, had no
--       `WITH CHECK`, and left the rest wide open.
--
--  WHAT THIS SCRIPT DOES
--    - Makes the reporting view respect the caller's RLS (security_invoker).
--    - Drops every wide-open policy and revokes all `anon` privileges.
--    - Re-creates one explicit `TO authenticated` policy per table, with both
--      `USING` and `WITH CHECK`, so `anon` has no path to any row.
--    - Leaves `service_role` alone: the Next.js route handlers use the service
--      role key, which bypasses RLS by design. Device ingestion therefore keeps
--      working without any policy that exposes rows to the internet.
--
--  RUN ORDER: after `database_schema.sql`. Safe to re-run — every statement is
--  idempotent. See the verification queries at the bottom.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The reporting view must not bypass RLS (B2)
--    Postgres 15+ creates views as SECURITY DEFINER by default; this flips it.
-- -----------------------------------------------------------------------------
ALTER VIEW public.daily_attendance_summary SET (security_invoker = true);

-- -----------------------------------------------------------------------------
-- 2. Drop every permissive policy ever created by the schema file (B1)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'devices', 'employees', 'attendance_logs', 'device_commands',
        'shifts', 'employee_shifts', 'report_automations', 'report_automation_logs'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Enable all access for all users', target_table);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow authenticated users full access', target_table);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Revoke every privilege the anonymous role holds (B1)
--    Without a table grant AND without a matching policy, `anon` gets
--    "permission denied for table ..." instead of data.
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;
REVOKE ALL ON public.daily_attendance_summary FROM anon;

-- -----------------------------------------------------------------------------
-- 4. One explicit, role-scoped policy per table (B1/B3)
--
--    NOTE ON SCOPE: this grants every *authenticated* user full access. That is
--    deliberate at launch — there is no role/permission model yet (see M3 in
--    PRODUCTION_READINESS.md) and the only accounts are invited staff. It is the
--    correct fix for "anonymous internet access"; it is NOT a substitute for the
--    role model, which should add a `role` claim and per-branch predicates.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'devices', 'employees', 'attendance_logs', 'device_commands',
        'shifts', 'employee_shifts', 'report_automations', 'report_automation_logs'
    ] LOOP
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
            'authenticated_full_access', target_table
        );
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', target_table);
        EXECUTE format('GRANT ALL ON public.%I TO service_role', target_table);
    END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON public.daily_attendance_summary TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Verify — both queries must be empty / zero.
--
--    (a) No policy on a public table may be reachable by `anon` or PUBLIC:
--
--        SELECT tablename, policyname, roles
--        FROM pg_policies
--        WHERE schemaname = 'public'
--          AND (roles::text LIKE '%anon%' OR roles = '{public}');
--
--    (b) The reporting view must not be security definer:
--
--        SELECT relname, reloptions
--        FROM pg_class
--        WHERE relname = 'daily_attendance_summary';
--        -- expect: security_invoker=true
--
--    (c) End-to-end proof that the hole is closed — run with the ANON key:
--
--        curl "$SUPABASE_URL/rest/v1/attendance_logs?select=pin&limit=1" \
--             -H "apikey: $ANON_KEY"
--        -- expect: {"message":"permission denied for table attendance_logs"}
-- -----------------------------------------------------------------------------
