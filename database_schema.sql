-- =============================================
-- ZKTeco BioTime Alternative - Database Schema
-- Run this in Supabase SQL Editor
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

-- 10. Enable RLS (Row Level Security)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_automation_logs ENABLE ROW LEVEL SECURITY;

-- 11. Setup RLS Policies (Safe creation if already existing)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'devices' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.devices FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.employees FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_logs' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.attendance_logs FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'device_commands' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.device_commands FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shifts' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.shifts FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employee_shifts' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.employee_shifts FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'report_automations' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.report_automations FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'report_automation_logs' AND policyname = 'Enable all access for all users') THEN
        CREATE POLICY "Enable all access for all users" ON public.report_automation_logs FOR ALL USING (true);
    END IF;
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
GRANT SELECT ON public.daily_attendance_summary TO authenticated, anon, service_role;
