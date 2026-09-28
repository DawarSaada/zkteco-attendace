-- =============================================
-- ZKTeco BioTime Alternative - Database Schema
-- Run this in Supabase SQL Editor
--
-- SECURITY: this file previously created `FOR ALL USING (true)` policies with
-- no `TO` clause on every table and then granted ALL to `anon`. A policy with
-- no `TO` applies to PUBLIC (including `anon`), so the public anon key could
-- read, insert, update and delete the whole database. That is fixed below:
-- policies are `TO authenticated` with an explicit `WITH CHECK`, `anon` gets no
-- grants, and the reporting view is created with `security_invoker` so it can
-- no longer bypass RLS.
--
-- If an older version of this file was ever run, also run `secure_rls.sql`,
-- which drops the legacy permissive policies and revokes the legacy grants.
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Devices Table
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    branch VARCHAR(255),
    ip_address VARCHAR(45),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Employees Table
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department VARCHAR(255),
    branch VARCHAR(255),
    designation VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Attendance Logs Table (with Audit Trail Columns)
CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) REFERENCES public.devices(sn) ON DELETE CASCADE,
    pin VARCHAR(255) REFERENCES public.employees(pin) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT '0', 
    verify_mode VARCHAR(50) DEFAULT '0', 
    work_code INTEGER DEFAULT 0, 
    is_manual BOOLEAN DEFAULT false,
    edited_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sn, pin, timestamp) 
);

-- Migration safety for existing tables:
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT false;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS edited_by UUID;
ALTER TABLE public.attendance_logs ADD COLUMN IF NOT EXISTS work_code INTEGER DEFAULT 0;

-- 4. Shifts Table
CREATE TABLE IF NOT EXISTS public.shifts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Employee Shifts Mapping Table
CREATE TABLE IF NOT EXISTS public.employee_shifts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) REFERENCES public.employees(pin) ON DELETE CASCADE,
    shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE,
    UNIQUE(pin)
);

-- 6. Device Commands Table (State Machine: PENDING -> SENT -> ACKNOWLEDGED / FAILED)
CREATE TABLE IF NOT EXISTS public.device_commands (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) REFERENCES public.devices(sn) ON DELETE CASCADE,
    command_str TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, SENT, ACKNOWLEDGED, FAILED
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

-- 7. Automated Monthly Reports Configuration Table
CREATE TABLE IF NOT EXISTS public.report_automations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    branch VARCHAR(255) NOT NULL,
    recipient_emails TEXT[] NOT NULL,
    cycle_start_day INT DEFAULT 26,
    cycle_end_day INT DEFAULT 25,
    dispatch_day INT DEFAULT 26,
    dispatch_time TIME DEFAULT '08:00:00',
    report_format VARCHAR(20) DEFAULT 'both', -- 'excel', 'pdf', 'both'
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    last_run_status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Automated Reports Dispatch Audit Logs Table
CREATE TABLE IF NOT EXISTS public.report_automation_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    automation_id UUID REFERENCES public.report_automations(id) ON DELETE SET NULL,
    branch VARCHAR(255),
    period_start DATE,
    period_end DATE,
    recipients TEXT[],
    status VARCHAR(50), -- 'SUCCESS', 'FAILED'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Reporting SQL View (Aggregated strictly by PIN + DATE so 1 employee only ever has 1 row per date)
CREATE OR REPLACE VIEW public.daily_attendance_summary AS
SELECT 
  a.pin,
  MAX(e.full_name) as full_name,
  MAX(e.department) as department,
  COALESCE(MAX(e.branch), MAX(d.branch)) as branch,
  MAX(d.name) as device_name,
  DATE(a.timestamp) as punch_date,
  MIN(a.timestamp) as check_in,
  MAX(a.timestamp) as check_out,
  COUNT(*) as total_punches,
  MAX(s.start_time) as shift_start,
  MAX(s.end_time) as shift_end
FROM public.attendance_logs a
LEFT JOIN public.employees e ON a.pin = e.pin
LEFT JOIN public.devices d ON a.sn = d.sn 
LEFT JOIN public.employee_shifts es ON e.pin = es.pin
LEFT JOIN public.shifts s ON es.shift_id = s.id
GROUP BY 
  a.pin, 
  DATE(a.timestamp);

-- Make the view respect the caller's RLS. Without this Postgres 15+ creates it
-- as SECURITY DEFINER, so it would read the base tables as its owner and leak
-- every attendance row to any role that can select from it.
ALTER VIEW public.daily_attendance_summary SET (security_invoker = true);

-- 10. Enable RLS (Row Level Security)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_automation_logs ENABLE ROW LEVEL SECURITY;

-- 11. Setup RLS Policies
-- Scoped `TO authenticated` with an explicit `WITH CHECK`: `anon` has no policy,
-- so it has no access even before the grants below are considered.
-- (Every authenticated user is an admin until a role model exists — see M3 in
-- PRODUCTION_READINESS.md.)
DO $$
DECLARE
    target_table TEXT;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'devices', 'employees', 'attendance_logs', 'device_commands',
        'shifts', 'employee_shifts', 'report_automations', 'report_automation_logs'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Enable all access for all users', target_table);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)',
            'authenticated_full_access', target_table
        );
    END LOOP;
END $$;

-- 12. Enable Supabase Realtime Publication for Live Monitoring
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_logs'
    ) THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_logs;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END $$;

-- 13. Grant permissions
-- `anon` is deliberately absent. Browser code authenticates first and then acts
-- as `authenticated`; device ingestion and API routes use `service_role`.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON public.daily_attendance_summary FROM anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role, postgres;
GRANT SELECT ON public.daily_attendance_summary TO authenticated, service_role, postgres;

-- 14. High-Performance B-Tree Indexes for Instant Query Response
CREATE INDEX IF NOT EXISTS idx_attendance_logs_timestamp ON public.attendance_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_pin_timestamp ON public.attendance_logs(pin, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_sn ON public.attendance_logs(sn);
CREATE INDEX IF NOT EXISTS idx_employees_pin ON public.employees(pin);
CREATE INDEX IF NOT EXISTS idx_employees_branch ON public.employees(branch);
CREATE INDEX IF NOT EXISTS idx_devices_sn ON public.devices(sn);
CREATE INDEX IF NOT EXISTS idx_devices_branch ON public.devices(branch);
CREATE INDEX IF NOT EXISTS idx_employee_shifts_pin ON public.employee_shifts(pin);
