-- Secure RLS Policies for ZKTeco Attendance Dashboard

-- Drop the old public policies
DROP POLICY IF EXISTS "Enable all access for all users" ON public.devices;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.employees;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.attendance_logs;

-- Enable RLS (if not already enabled)
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (Admins logged into Next.js) full access
CREATE POLICY "Allow authenticated users full access" ON public.devices FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users full access" ON public.employees FOR ALL TO authenticated USING (true);
CREATE POLICY "Allow authenticated users full access" ON public.attendance_logs FOR ALL TO authenticated USING (true);

-- Note: The Node.js backend uses the Supabase Service Role Key (`SUPABASE_SERVICE_ROLE_KEY`), 
-- which automatically bypasses RLS policies. Therefore, the backend listener will continue 
-- to insert attendance punches successfully without needing any additional policies here.
