-- =============================================
-- Phase 1 — switch the legacy report view over to the engine
-- Run this ONLY after:
--   1. `attendance_engine.sql` has been applied, AND
--   2. the backfill has run and been spot-checked, e.g.
--        POST /api/attendance/recompute  { "start": "2026-01-01", "end": "2026-12-31" }
--      (or let the nightly cron build it up going forward).
--
-- Why it is a separate file: `daily_attendance_summary` is what the Excel/PDF
-- export routes read. Redefining it in place while `attendance_days` is empty
-- would blank those exports. The application's own reports page reads
-- `attendance_days` directly and falls back to the legacy view, so it does not
-- need this switch — only the exports do.
--
-- The new view keeps the OLD column names/shape so the existing export code
-- keeps working unchanged, and appends the engine columns (status, minutes).
-- It reads one row per (pin, work_date), so cross-midnight shifts no longer
-- split into two rows.
--
-- Rollback: re-run the `daily_attendance_summary` block from `database_schema.sql`.
-- =============================================

CREATE OR REPLACE VIEW public.daily_attendance_summary AS
SELECT
  ad.pin,
  e.full_name,
  e.department,
  e.branch,
  NULL::varchar AS device_name,
  ad.work_date AS punch_date,
  ad.first_in AS check_in,
  ad.last_out AS check_out,
  ad.punch_count AS total_punches,
  sp.start_time AS shift_start,
  sp.end_time AS shift_end,
  ad.status,
  ad.expected_minutes,
  ad.worked_minutes,
  ad.late_minutes,
  ad.early_leave_minutes,
  ad.overtime_minutes,
  ad.shift_id
FROM public.attendance_days ad
LEFT JOIN public.employees e ON e.pin = ad.pin
LEFT JOIN LATERAL (
  SELECT start_time, end_time
  FROM public.shift_periods
  WHERE shift_id = ad.shift_id
  ORDER BY seq
  LIMIT 1
) sp ON true;

-- Keep the view inside the caller's RLS (see PRODUCTION_READINESS.md B1).
ALTER VIEW public.daily_attendance_summary SET (security_invoker = true);

REVOKE ALL ON public.daily_attendance_summary FROM anon;
GRANT SELECT ON public.daily_attendance_summary
  TO authenticated, service_role, postgres;
