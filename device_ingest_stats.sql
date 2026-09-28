-- =============================================
-- Device ingest statistics (additive migration)
-- Run after `phase4_roles_audit.sql` — the write policy below uses `can_write()`.
--
-- WHY THIS EXISTS
-- The terminal pushes several different kinds of payload to /iclock/cdata
-- (`table=ATTLOG`, `USERINFO`, `OPERLOG`, `ATTPHOTO`, templates, ...). Before
-- this migration the only evidence of what arrived was the data that happened to
-- be stored: a table the app does not handle (OPERLOG, ATTPHOTO) was parsed,
-- discarded, and answered with "OK" — so the terminal believed it had delivered
-- and never retried. There was no way to see that from the dashboard.
--
-- `device_ingest_stats` records, per (terminal, table): when it was last
-- received, how many times, how many records arrived, how many were actually
-- stored, how many were dropped, and whether the app handles that table at all.
-- One row per pair, incremented in place by `record_device_ingest()`.
--
-- Idempotent: safe to run more than once.
-- =============================================

-- ----------------------------------------------------------------------------
-- 1. The stats table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_ingest_stats (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) NOT NULL,
    -- Upper-cased ADMS table name, e.g. ATTLOG / OPERLOG / ATTPHOTO.
    table_name VARCHAR(48) NOT NULL,
    -- False means: the terminal sends this and we currently discard it.
    handled BOOLEAN NOT NULL DEFAULT true,
    first_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Number of POSTs that carried this table.
    received_payloads BIGINT NOT NULL DEFAULT 0,
    -- Records (lines) seen / written / discarded.
    received_records BIGINT NOT NULL DEFAULT 0,
    stored_records BIGINT NOT NULL DEFAULT 0,
    dropped_records BIGINT NOT NULL DEFAULT 0,
    -- Records in the most recent payload, so a table that went quiet is visible.
    last_record_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (sn, table_name)
);

CREATE INDEX IF NOT EXISTS idx_device_ingest_stats_sn
    ON public.device_ingest_stats(sn, last_received_at DESC);

-- ----------------------------------------------------------------------------
-- 2. Atomic increment
--    A read-modify-write from the route would lose updates whenever two
--    terminals POST at the same moment; Postgres does it in one statement.
--    Devices post through the service role (which bypasses RLS), so this is
--    deliberately SECURITY INVOKER and granted to service_role only.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_device_ingest(
    p_sn TEXT,
    p_table TEXT,
    p_records INTEGER,
    p_stored INTEGER,
    p_dropped INTEGER,
    p_handled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.device_ingest_stats AS s (
        sn, table_name, handled,
        received_payloads, received_records, stored_records, dropped_records,
        last_record_count, first_received_at, last_received_at
    )
    VALUES (
        p_sn,
        upper(p_table),
        p_handled,
        1,
        GREATEST(p_records, 0),
        GREATEST(p_stored, 0),
        GREATEST(p_dropped, 0),
        GREATEST(p_records, 0),
        NOW(),
        NOW()
    )
    ON CONFLICT (sn, table_name) DO UPDATE SET
        handled           = EXCLUDED.handled,
        received_payloads = s.received_payloads + 1,
        received_records  = s.received_records + GREATEST(p_records, 0),
        stored_records    = s.stored_records + GREATEST(p_stored, 0),
        dropped_records   = s.dropped_records + GREATEST(p_dropped, 0),
        last_record_count = GREATEST(p_records, 0),
        last_received_at  = NOW();
END $$;

REVOKE ALL ON FUNCTION public.record_device_ingest(TEXT, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_device_ingest(TEXT, TEXT, INTEGER, INTEGER, INTEGER, BOOLEAN) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 3. RLS + grants (read for any signed-in user, write for owner/admin)
-- ----------------------------------------------------------------------------
ALTER TABLE public.device_ingest_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_full_access ON public.device_ingest_stats;
DROP POLICY IF EXISTS device_ingest_stats_read ON public.device_ingest_stats;
DROP POLICY IF EXISTS device_ingest_stats_write ON public.device_ingest_stats;

CREATE POLICY device_ingest_stats_read ON public.device_ingest_stats
    FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY device_ingest_stats_write ON public.device_ingest_stats
    FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());

GRANT ALL ON public.device_ingest_stats TO authenticated, service_role, postgres;
REVOKE ALL ON public.device_ingest_stats FROM anon;

-- ----------------------------------------------------------------------------
-- 4. Verification
-- ----------------------------------------------------------------------------
-- select sn, table_name, handled, received_records, stored_records, dropped_records, last_received_at
--   from public.device_ingest_stats order by sn, table_name;
-- select table_name, handled, count(*) from public.device_ingest_stats group by table_name, handled;
--   → a row with handled = false, or a canonical table that has no row at all,
--     is a table the terminal either sends and we discard, or has never sent.
