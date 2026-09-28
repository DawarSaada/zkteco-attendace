# ZKTeco Attendance — BioTime-Pro Alternative

Attendance capture and reporting for ZKTeco biometric terminals running in **ADMS push mode**.
Terminals POST their punches to `/iclock/*`; this app stores them in Supabase and provides the
dashboard, reporting, exports and scheduled email dispatch.

## What this is (and is not)

It is the **attendance data plane and reporting layer** for the customer's terminals.

It is **not** a ZKTeco BioTime replacement, but BioTime parity Phases 1–5 and 7 are now built:
a real attendance rule engine (shift periods, overnight handling, late/early/absent/overtime),
device provisioning and biometric-template backup, leave/holidays/exceptions, roles +
audit, a six-report pack with per-rule scheduling, and an employee self-service page. Phase 6
(access control — doors, zones, anti-passback) is deliberately **not built**; the parity doc
explains why. Read [`BIOTIME_PARITY.md`](./BIOTIME_PARITY.md) §4.1 for the status table before
promising parity, and for the decision that still needs to be made about which system is
authoritative for payroll hours.

## Documentation index

| Document | What it covers |
|---|---|
| [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) | Security assessment, blockers B1–B8 and their remediation, deploy checklist, UI overhaul log, Phase 1 engine (§13), Phases 2–5 (§14), Phase 7 (§15), known lint debt (§16), device data visibility (§17) |
| [`BIOTIME_PARITY.md`](./BIOTIME_PARITY.md) | BioTime feature comparison, the phased plan and its status table (§4.1) |
| [`database_schema.sql`](./database_schema.sql) | Base schema — **safe to re-run**, and locked down by default |
| [`secure_rls.sql`](./secure_rls.sql) | RLS lock-down for databases created by an older schema. Run after any deploy that predates §12 |
| [`attendance_engine.sql`](./attendance_engine.sql) | Additive, idempotent: the Phase 1 rule-engine tables (policies, shift periods, effective-dated assignments, holidays, `attendance_days`) |
| [`attendance_engine_switch_view.sql`](./attendance_engine_switch_view.sql) | Points the legacy report view (and the Excel/PDF exports) at the engine. Run after the backfill |
| [`phase2_provisioning.sql`](./phase2_provisioning.sql) | Device user mirror, device settings, biometric templates, command state-machine columns |
| [`phase3_leave_exceptions.sql`](./phase3_leave_exceptions.sql) | Leave types/requests/balances, punch-change requests, punch-level exceptions |
| [`phase4_roles_audit.sql`](./phase4_roles_audit.sql) | Profiles + role helpers, per-command RLS policies, append-only audit log |
| [`phase5_reporting.sql`](./phase5_reporting.sql) | Report automations gain `report_type` and `cadence` |
| [`phase7_self_service.sql`](./phase7_self_service.sql) | `profiles.employee_pin`, self-service request labelling |
| [`device_ingest_stats.sql`](./device_ingest_stats.sql) | Per-terminal ADMS ingest counters: what each terminal sent, and what we discarded |
| [`frontend/.env.example`](./frontend/.env.example) | Every environment variable, including the two required secrets |

## The attendance engine

The rule engine lives in [`frontend/lib/attendance/`](./frontend/lib/attendance): `engine.ts` is
pure (work-date resolution + day evaluation: late, early leave, absent, overtime, weekend,
holiday, leave), and `recompute.ts` is the only part that talks to the database. The computed
summary is the `attendance_days` table, one row per employee per **work date** — so an overnight
shift is one row, not two. Ingestion, manual punch edits, a backfill route
(`POST /api/attendance/recompute`) and a nightly cron all keep it current.

`npm test` (from `frontend/`) runs the engine, report and payslip-summary tests with the Node
built-in test runner — no extra dependency.

## Beyond the engine

- **Provisioning** (`/dashboard/provisioning`): push an employee or a whole branch to a terminal
  from a typed command vocabulary, mirror the terminal's user list for a diff, back up biometric
  templates, and push device settings.
- **Leave & holidays** (`/dashboard/leave`) and the **Exceptions** / **Approvals** inboxes on the
  Reports page.
- **Roles** (`/dashboard/users`): `owner` / `admin` / `operator` / `viewer`, enforced in the API
  *and* in RLS, with an append-only audit log.
- **Reports**: six report types (timecard, exceptions, absence, overtime, branch rollup, late)
  via `/api/reports/run/[type]`, schedulable per cadence and time.
- **Self-service** (`/dashboard/me`): an employee's own month, payslip hours and correction
  requests — a correction is a punch-change request, so an operator and an employee share one
  approval queue. An owner links a login to an employee PIN from the Users screen.
- **Device data panel** (`/dashboard/devices`): per terminal, what each ADMS table has actually
  delivered — when it was last received, how many records arrived, how many were stored and how
  many were discarded. Punches, the user list and templates are ingested; **OPERLOG**
  (verification attempts, including denied ones) and **ATTPHOTO** (the punch photo) are received
  and discarded, and this panel is where that is visible instead of silent. See
  `PRODUCTION_READINESS.md` §17.

## Before deploying

1. Run `secure_rls.sql` in the Supabase SQL editor.
2. Set `ADMS_SECRET_TOKEN` and `CRON_SECRET` in the hosting environment. Both are **required**:
   without them device ingestion and the monthly report job deliberately fail closed (503).
3. Run `attendance_engine.sql`, then backfill the summary with
   `POST /api/attendance/recompute {"start":"…","end":"…"}`. (Optional but recommended once
   the numbers look right: run `attendance_engine_switch_view.sql` so the exports read the
   engine too.)
4. Run `phase2_provisioning.sql`, `phase3_leave_exceptions.sql`, `phase4_roles_audit.sql`,
   `phase5_reporting.sql`, `phase7_self_service.sql` and `device_ingest_stats.sql` — all additive
   and idempotent, in that order. Then sign in once: the first user is bootstrapped as `owner` and
   manages everyone else from `/dashboard/users`, including linking each employee's login to
   their PIN.
5. Commission each terminal with `https://<domain>/iclock?token=<ADMS_SECRET_TOKEN>`.

See section 12 of `PRODUCTION_READINESS.md` for the security checklist, §13 for the
attendance-engine steps, §14–§15 for the later phases, and §16 for the known lint debt.
