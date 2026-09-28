-- =============================================
-- Phase 5 — Reporting pack (additive migration)
-- Run after `attendance_engine.sql`.
--
-- Extends `report_automations` from "one monthly branch timecard" to
-- "any report, any cadence, any recipient":
--   report_type  timecard | exceptions | absence | overtime | rollup | late
--   cadence      monthly | weekly | daily
--
-- `dispatch_time` (which the UI has always exposed) is now honoured: the dispatch
-- cron runs hourly and only fires a rule in its own hour (M4).
--
-- `dispatch_day` keeps its meaning per cadence: day-of-month for monthly,
-- ISO weekday (0 = Sunday) for weekly, ignored for daily.
--
-- Idempotent: safe to run more than once.
-- =============================================

ALTER TABLE public.report_automations
    ADD COLUMN IF NOT EXISTS report_type VARCHAR(32) NOT NULL DEFAULT 'timecard';

ALTER TABLE public.report_automations
    ADD COLUMN IF NOT EXISTS cadence VARCHAR(16) NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
    ALTER TABLE public.report_automations
        ADD CONSTRAINT report_automations_report_type_check
        CHECK (report_type IN ('timecard', 'exceptions', 'absence', 'overtime', 'rollup', 'late'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.report_automations
        ADD CONSTRAINT report_automations_cadence_check
        CHECK (cadence IN ('monthly', 'weekly', 'daily'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Record which report a dispatch log row belongs to.
ALTER TABLE public.report_automation_logs
    ADD COLUMN IF NOT EXISTS report_type VARCHAR(32);

-- Verification
-- select branch, report_type, cadence, dispatch_time, is_active from public.report_automations order by branch;
