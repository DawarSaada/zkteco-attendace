-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Devices Table
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    branch VARCHAR(255),
    ip_address VARCHAR(45),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Employees Table
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department VARCHAR(255),
    branch VARCHAR(255),
    designation VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Attendance Logs Table
CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) REFERENCES public.devices(sn) ON DELETE CASCADE,
    pin VARCHAR(255) REFERENCES public.employees(pin) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50), -- e.g., '0' for Check-In, '1' for Check-Out (or translated strings)
    verify_mode VARCHAR(50), -- e.g., 'Fingerprint', 'Face', etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(pin, timestamp) -- Unique constraint to avoid duplicates
);

CREATE TABLE public.shifts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.employee_shifts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    pin VARCHAR(255) REFERENCES public.employees(pin) ON DELETE CASCADE,
    shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE,
    UNIQUE(pin)
);

-- Reporting SQL View (Rewritten to support dynamic shifts)
CREATE OR REPLACE VIEW public.daily_attendance_summary AS
SELECT 
  a.pin,
  e.full_name,
  e.department,
  e.branch,
  DATE(a.timestamp) as punch_date,
  MIN(a.timestamp) as check_in,
  MAX(a.timestamp) as check_out,
  COUNT(*) as total_punches,
  s.start_time as shift_start,
  s.end_time as shift_end
FROM public.attendance_logs a
LEFT JOIN public.employees e ON a.pin = e.pin
LEFT JOIN public.employee_shifts es ON e.pin = es.pin
LEFT JOIN public.shifts s ON es.shift_id = s.id
GROUP BY a.pin, e.full_name, e.department, e.branch, DATE(a.timestamp), s.start_time, s.end_time;

CREATE TABLE public.device_commands (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sn VARCHAR(255) REFERENCES public.devices(sn) ON DELETE CASCADE,
    command_str TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_commands ENABLE ROW LEVEL SECURITY;

-- Allow all for development purposes. 
-- In a real production setup with Supabase Auth, you'd restrict these policies.
CREATE POLICY "Enable all access for all users" ON public.devices FOR ALL USING (true);
CREATE POLICY "Enable all access for all users" ON public.employees FOR ALL USING (true);
CREATE POLICY "Enable all access for all users" ON public.attendance_logs FOR ALL USING (true);
