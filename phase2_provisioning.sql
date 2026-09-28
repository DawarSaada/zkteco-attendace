-- =============================================
-- Phase 2 — Device provisioning and template safety (additive migration)
-- Run after `database_schema.sql` / `secure_rls.sql` (and after `attendance_engine.sql`).
--
-- Adds:
--   1. the missing columns on `device_commands` that make command acknowledgement
--      work (stable per-device sequence ID, attempts, sent_at) — see H5,
--   2. `device_users`      — what is actually enrolled ON the terminal,
--   3. `biometric_templates` — pulled templates, so a dead terminal is not a data
--      loss (privacy-sensitive: see the note below),
--   4. `device_settings`   — last parameters pushed to a terminal.
--
-- Idempotent: safe to run more than once.
-- =============================================

-- ----------------------------------------------------------------------------
-- 1. Command state machine (H5)
--
-- Before this, `getrequest` numbered commands `index + 1` per response and
-- `devicecmd` acknowledged EVERY `SENT` row for the device. Nothing correlated
-- a device's `ID=<n>` to a row, so a reboot and a data query sent together would
-- both be marked done by the first reply.
-- ----------------------------------------------------------------------------
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS device_seq INTEGER;
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS acked_at TIMESTAMPTZ;
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS last_error TEXT;
-- The typed command that produced `command_str`, so the UI can retry it.
ALTER TABLE public.device_commands ADD COLUMN IF NOT EXISTS payload JSONB;

-- The device references a command by `device_seq`; it must be unique per SN.
CREATE UNIQUE INDEX IF NOT EXISTS device_commands_sn_seq
    ON public.device_commands(sn, device_seq) WHERE device_seq IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_commands_pending
    ON public.device_commands(sn, status, created_at);

-- ----------------------------------------------------------------------------
-- 2. device_users — the terminal's own user list, mirrored on heartbeat/USERINFO
--    ingest. This is what makes the "database vs device" diff view possible.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) NOT NULL REFERENCES public.devices(sn) ON DELETE CASCADE,
    pin VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    privilege INTEGER DEFAULT 0,
    card VARCHAR(64),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (sn, pin)
);

CREATE INDEX IF NOT EXISTS idx_device_users_sn ON public.device_users(sn);
CREATE INDEX IF NOT EXISTS idx_device_users_pin ON public.device_users(pin);

-- ----------------------------------------------------------------------------
-- 3. biometric_templates — pulled fingerprint / face templates.
--
--    PRIVACY: a fingerprint template is sensitive personal data. This table is
--    readable by any authenticated user until Phase 4 introduces roles, at which
--    point it must be restricted to `owner`. Do not export it in reports.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.biometric_templates (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) NOT NULL,
    pin VARCHAR(255) NOT NULL,
    kind VARCHAR(32) NOT NULL DEFAULT 'fingerprint', -- fingerprint | face | card
    fid INTEGER NOT NULL DEFAULT 0,
    size INTEGER,
    template TEXT NOT NULL,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (sn, pin, kind, fid)
);

CREATE INDEX IF NOT EXISTS idx_biometric_templates_pin ON public.biometric_templates(pin);

-- ----------------------------------------------------------------------------
-- 4. device_settings — the parameters last pushed to a terminal, so the console
--    can show current state without querying the device for every render.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_settings (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) NOT NULL REFERENCES public.devices(sn) ON DELETE CASCADE,
    key VARCHAR(64) NOT NULL,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (sn, key)
);

-- ----------------------------------------------------------------------------
-- 5. RLS + grants for the new tables (same posture as the rest of the schema).
-- ----------------------------------------------------------------------------
ALTER TABLE public.device_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biometric_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'device_users', 'biometric_templates', 'device_settings'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'authenticated_full_access', target_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
            'authenticated_full_access', target_table
        );
    END LOOP;
END $$;

REVOKE ALL ON public.device_users FROM anon;
REVOKE ALL ON public.biometric_templates FROM anon;
REVOKE ALL ON public.device_settings FROM anon;

GRANT ALL ON public.device_users TO authenticated, service_role, postgres;
GRANT ALL ON public.biometric_templates TO authenticated, service_role, postgres;
GRANT ALL ON public.device_settings TO authenticated, service_role, postgres;

-- ----------------------------------------------------------------------------
-- 6. Verification
-- ----------------------------------------------------------------------------
-- select column_name from information_schema.columns
--   where table_name = 'device_commands' and column_name in ('device_seq','attempts','sent_at','acked_at','payload');
-- select sn, status, count(*) from public.device_commands group by sn, status;
-- select count(*) from public.device_users;
-- select count(*) from public.biometric_templates;
