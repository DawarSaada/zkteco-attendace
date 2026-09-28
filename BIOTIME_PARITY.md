# Does this work like ZKTeco BioTime? — Gap analysis and implementation plan

**Short answer: no.** This app is an **ADMS ingest + reporting layer for a single
terminal family**; ZKTeco BioTime is a full attendance *and access-control* platform with a
rule engine, device provisioning, leave management and a role model.

The protocol slice is genuinely equivalent — a ZKTeco terminal in **ADMS / push mode** talks
to `/iclock/*` here exactly as it does to BioTime, and the punch data captured is the same
data. Everything that BioTime does *on top of* that stream is missing, and one of those gaps
(attendance rules) directly affects payroll correctness, so it cannot be waved away.

This document is deliberately blunt: §1 is what actually works today, §2 is the parity
matrix, §3 is why the gaps matter commercially, §4 is the phased plan, §5 is what "same as
BioTime" would never mean even after all of it.

---

## 1. What exists today (verified against the code, not the UI copy)

**Device layer — push/ADMS only**

| Capability | Where |
|---|---|
| `ATTLOG` punch ingestion, batched, idempotent on `UNIQUE(sn, pin, timestamp)` | `app/api/iclock/cdata/route.ts` |
| `USERINFO` (device-side user names) ingest | same |
| Heartbeat → `devices.last_active` | same |
| Command queue `PENDING → SENT → ACKNOWLEDGED/FAILED` | `device_commands`, `getrequest`, `devicecmd` |
| Commands actually issued: `REBOOT`, `DATA QUERY ATTLOG` | `app/dashboard/devices/page.tsx` |
| Timestamp validation / quarantine of malformed lines | `cdata` `isValidTimestamp()` |

**Data model** — `devices`, `employees` (pin, full_name, department, branch, designation),
`attendance_logs` (sn, pin, timestamp, status, verify_mode, work_code, is_manual, edited_by),
`device_commands`, `shifts` (name, start_time, end_time), `employee_shifts` (`UNIQUE(pin)` —
one shift per person), `report_automations`, `report_automation_logs`, plus the
`daily_attendance_summary` view.

**Application features** — overview dashboard, live monitor (poll + Realtime), employees CRUD,
shifts CRUD + assignment, daily attendance report with sorting and manual punch
add/edit/delete (audited via `is_manual`/`edited_by`), Excel + per-employee PDF export,
monthly per-branch email dispatch (Vercel cron + Resend/SMTP), EN/AR i18n with RTL, dark mode.

**The calculation today is `MIN(timestamp)` = check-in and `MAX(timestamp)` = check-out, grouped
by `(pin, DATE(timestamp))`** — see the view in `database_schema.sql`. That is the whole
attendance engine. There is no concept of a late arrival, an early departure, an absence, an
overtime hour, a holiday or an approved leave anywhere in the schema or the codebase (grep for
`holiday`, `overtime`, `absent`, `leave_balance` returns nothing).

---

## 2. Parity matrix

Legend: **✅ parity** · **🟡 partial** · **❌ missing** · **➖ out of product scope decision**

| Module | BioTime | This app | Verdict |
|---|---|---|---|
| ADMS push ingest (ATTLOG/USERINFO) | ✅ | ✅ batched, idempotent, validated | ✅ |
| Terminal heartbeat + online/offline | ✅ | ✅ 30 s re-evaluation | ✅ |
| Remote reboot | ✅ | ✅ (queued, acknowledgement broken — see H5) | 🟡 |
| Pull punches on demand (`DATA QUERY ATTLOG`) | ✅ | ✅ | ✅ |
| **Push employees to terminals (provisioning)** | ✅ upload user records | ❌ | ❌ |
| **Push/download biometric templates (fingerprint, face, card)** | ✅ full template management | ❌ | ❌ |
| Device parameters (verify mode 1:1/1:N, threshold, comm key, time sync, clear data) | ✅ | ❌ | ❌ |
| Firmware upgrade / device capability query | ✅ | ❌ | ❌ |
| Multi-device, multi-area deployment | ✅ | 🟡 one terminal, `branch` is a free-text string | 🟡 |
| **Attendance rules: time tables, periods, flexible/auto shift** | ✅ | ❌ single shift, single period, no rules | ❌ |
| **Overnight / cross-midnight shifts** | ✅ | ❌ (see §3.2) | ❌ |
| **Late / early-leave / grace periods** | ✅ | ❌ | ❌ |
| **Absent marking, weekend & shift-calendar rules** | ✅ | ❌ | ❌ |
| **Overtime calculation & approval** | ✅ | ❌ | ❌ |
| **Holiday calendar** | ✅ | ❌ | ❌ |
| **Leave management (types, balances, requests, approval)** | ✅ | ❌ | ❌ |
| Shift assignment history / roster per day | ✅ effective-dated | ❌ current assignment only, `UNIQUE(pin)` | ❌ |
| Raw transaction browser (search/filter/photo) | ✅ | 🟡 per employee+day only, no photo | 🟡 |
| Manual punch add/edit/delete | ✅ with approval flow | 🟡 works, audited, no approval step | 🟡 |
| Exception handling (missed punch + reason code) | ✅ | ❌ | ❌ |
| Exception/absence/overtime/timecard reports | ✅ ~10 report types | 🟡 one daily summary + exports | 🟡 |
| Scheduled email reports | ✅ | ✅ monthly per branch | ✅ |
| Excel / PDF export | ✅ | ✅ Excel grid + per-employee PDF timecard | ✅ |
| **Roles & permissions, per-department data scope** | ✅ admin/operator/user | ❌ single admin session, everyone is root | ❌ |
| Operation/audit log of admin actions | ✅ | 🟡 only `is_manual` + `edited_by` on punches | 🟡 |
| Employee photo capture on punch | ✅ | ❌ | ❌ |
| Access control (doors, zones, anti-passback, interlock) | ✅ (access-control models) | ❌ | ➖ |
| Visitor management | ✅ | ❌ | ➖ |
| Employee self-service portal / mobile punch | ✅ | ❌ | ➖ |
| Third-party API / webhooks | ✅ | 🟡 internal-only JSON routes, no API keys | 🟡 |
| i18n + RTL | ✅ | ✅ EN/AR | ✅ |

**Score: the ingest and reporting spine matches; the attendance engine, the provisioning half
of device management, and the authorization model do not exist.** In BioTime terms, this app is
roughly *"Transactions + a thin report set"* with none of *"Time Tables, Rules, Leave, Device
Management, Users & Roles"*.

---

## 3. Why the missing pieces actually matter

### 3.1 Payroll correctness is currently an assumption, not a calculation
`MIN`/`MAX` per day cannot answer the questions a payroll clerk asks: who was late, by how
much, who left early, who was absent but rostered, how many overtime hours were approved. Today
those are eyeballed from raw timestamps in Excel exports. BioTime's value proposition *is* that
computation. Until it exists here, HR will keep a spreadsheet beside the app — which is exactly
the failure mode this project was built to remove.

### 3.2 Cross-midnight shifts silently corrupt the report — **fixed in Phase 1**
`shifts.start_time`/`end_time` are `TIME` with no date and no `day_offset`, and the view groups
by `DATE(timestamp)`. A night shift 22:00→06:00 therefore produces **two rows for one worked
shift** (one for the pre-midnight punches, one for the post-midnight ones), and whichever side
has no punch shows "Missing check-out". Any site with night security or a 24 h operation gets
wrong numbers with no warning. This is a correctness bug, not a feature gap.

> **Phase 1 fixes this.** Punches are now attributed to a *work date* (the shift day), not a
> calendar day, so a 22:00→06:00 shift yields one row. Since the app reads the new table but the
> legacy view is still what the exports read until `attendance_engine_switch_view.sql` is run,
> the fix is live in the report only after the two steps in `PRODUCTION_READINESS.md` §13.

### 3.3 Provisioning is half-implemented
The app can *read* from terminals but cannot *write to* them. Onboarding 15 employees required
touching the terminal itself (or BioTime) by hand; there is no way to push a new hire's record
or their fingerprint from this dashboard, and no backup of enrolled templates, which are
hardware-resident — if a terminal dies, the enrollments die with it.

### 3.4 Everyone is a super-admin
Any authenticated account can delete employees, rewrite punches, reboot terminals and change
automations. `is_manual`/`edited_by` records *that* a punch changed, but nothing prevents it and
there is no operation log for the other destructive actions. For a system that feeds payroll
this is the second-most-important gap after the rules engine.

---

## 4. Implementation plan

Ordered so that each phase ships standalone value and none blocks on the next. Effort is
developer-days for one experienced dev, including tests; assume the CI/test harness from
`PRODUCTION_READINESS.md` H1 lands first.

### Phase 1 — Attendance engine (the must-have for payroll) · 8–12 days — **IMPLEMENTED**

> **Status: built.** The schema, the pure work-date resolver and evaluator (with 37 passing
> tests, including the cross-midnight case), the recompute pipeline (ingest hook, manual-punch
> hook, backfill route and nightly cron) and the report columns/filter are all in the tree. The
> two remaining steps are owner-run: apply `attendance_engine.sql` and run the backfill. What
> shipped, and what was deliberately left for later phases, is in
> [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) §13. The plan below is retained as the
> spec the implementation was measured against.

**Goal:** replace `MIN`/`MAX` with an explicit, testable rule evaluation, and stop the
cross-midnight corruption.

1. **Schema** (new, additive — never edit the live view in place until the app reads the new one):
   - `attendance_policies` — `id`, `name`, `grace_in_minutes`, `grace_out_minutes`,
     `min_minutes_for_full_day`, `weekend_days int[]`, `overtime_after_minutes`,
     `requires_overtime_approval bool`, `is_default`.
   - `shift_periods` — `shift_id`, `seq` (1..3), `start_time`, `end_time`, `day_offset`
     (`end_time` on the next day → `1`), `crosses_midnight` derived. Replaces the flat
     `shifts.start_time/end_time` (keep those columns as the "period 1" projection for
     backward compatibility, deprecate later).
   - `employee_shift_assignments` — `pin`, `shift_id`, `effective_from`, `effective_to`.
     Replaces `UNIQUE(pin)` in `employee_shifts` so history and future-dated rosters work.
   - `holidays` — `date`, `name`, `scope` (`all` | branch), `is_working_day`.
   - `attendance_days` (the new summary table, one row per `pin` + `work_date`) — `expected_minutes`,
     `worked_minutes`, `late_minutes`, `early_leave_minutes`, `overtime_minutes`,
     `status` (`present | late | absent | leave | holiday | off`, `incomplete`), `first_in`,
     `last_out`, `punch_count`, `computed_at`, `policy_id`.
2. **Work-date resolution.** A shared helper that, given a shift's periods and day offsets,
   attributes each punch to the correct `work_date` (a 22:00→06:00 shift's 02:00 punch belongs
   to the previous day's work date). Unit-test the boundaries: exactly 00:00, period gaps,
   three-period shifts, punches before the first period, DST-free Riyadh assumptions.
3. **Evaluator.** Pure function `evaluateDay(punches, expectedShift, policy, holiday, leave) →
   attendance_days row`. No I/O — this is where the tests live.
4. **Recompute pipeline.** On ingest (`cdata`) and on manual punch changes, mark affected
   `(pin, work_date)` dirty; a `/api/attendance/recompute` route (and the midnight cron)
   recomputes. Backfill script for history.
5. **Report switch-over.** `daily_attendance_summary` becomes a compatibility view over
   `attendance_days`; the reports page gains status, late/early/overtime columns and a filter
   for "only exceptions". Keep the old shape available until the UI is fully migrated.
6. **Acceptance:** for a fixture of 5 employees × 31 days including one night shift, one
   holiday, one absent day and one late arrival, `attendance_days` matches a hand-computed
   expected table; the cross-midnight case produces **one** row, not two.

### Phase 2 — Device provisioning and template safety · 6–9 days — **IMPLEMENTED**

> **As built.** `lib/adms/commands.ts` is the typed command vocabulary (no hand-assembled
> strings anywhere), and `lib/adms/queue.ts` plus the rewritten `iclock/getrequest` and
> `iclock/devicecmd` routes give every command a stable id, an `attempts` count and true
> acknowledgement correlation — H5 is closed. `/api/devices/provision` pushes one employee or a
> whole branch, mirrors the terminal's user list into `device_users`, pulls templates into
> `biometric_templates`, and answers a "device vs database" diff. `/dashboard/provisioning` is
> the console. Migration: `phase2_provisioning.sql`.
> Not built: firmware/capability negotiation (vendor territory, see §5).

**Goal:** the dashboard becomes the source of truth for what is on the terminal.

1. Extend the ADMS command vocabulary in a typed module (`DATA UPDATE USERINFO`,
   `DATA UPDATE USERPIC`, `DATA UPDATE FINGERPRINT`, `DATA UPDATE BIODATA`, `DATA DELETE
   USERINFO`, `SET OPTIONS`, `CHECK`, `CLEAR LOG`, `SET TIME`), each with a validated payload
   builder — never hand-assembled strings from the UI.
2. **Fix the command state machine first** (`PRODUCTION_READINESS.md` H5): stable per-command
   IDs, correlation on acknowledgement, `attempts`/`sent_at`, and reconciliation of commands
   stuck in `SENT`. Provisioning is unusable without this.
3. Device console UI: push a single employee or a whole branch, verify by reading `USERINFO`
   back, per-command status with retry, and "device user list vs database" diff view.
4. **Template backup:** `DATA QUERY FINGERPRINT` on demand → store templates in a
   `biometric_templates` table (`pin`, `sn`, `kind`, `template bytea/text`, `captured_at`), with
   a documented restore path (re-push to the same or a replacement terminal). This is the
   feature that saves the customer on hardware failure; it also has privacy implications that
   must be written into the runbook (templates are sensitive personal data — encrypt at rest,
   restrict read to an owner role from Phase 4).
5. Device parameters screen: verify mode, matching threshold, comm key, time sync, clear-log.
6. **Acceptance:** create an employee in the dashboard → appears on the terminal's user list
   within one poll cycle; template pulled, terminal wiped, template re-pushed, employee can
   authenticate again.

### Phase 3 — Leave, holidays and exceptions · 6–8 days — **IMPLEMENTED**

> **As built.** `leave_types`, `leave_requests`, `leave_balances`, `punch_change_requests` and
> `exceptions` ship in `phase3_leave_exceptions.sql`. `/dashboard/leave` is the request +
> balance + holiday screen; the recompute pipeline generates punch-level exceptions; the
> reports page carries an **Exceptions inbox** and an **Approvals inbox**. A manual punch edit by
> a non-writer becomes a pending request instead of being applied silently.
> Deviation: accrual is a per-type annual entitlement, not a formula — balances derive `used`
> from approved requests so they cannot drift, which was the point.

1. `leave_types` (name, paid, requires_approval, accrual rule), `leave_requests` (`pin`,
   `type_id`, `from_date`, `to_date`, `status`, `decided_by`, `decided_at`), `leave_balances`
   (per-year entitlement/used — derive `used` from approved requests to avoid drift).
2. Holiday calendar UI + `holidays` scope per branch; the evaluator already accepts it.
3. **Exception workflow:** a punch-level `exceptions` table (`pin`, `work_date`, `kind`
   (`missing_check_out` | `missing_check_in` | `duplicate` | `unmatched_device`), `state`,
   `reason_code`, `note`, `resolved_by`). The reports page gets an "Exceptions" inbox so the HR
   clerk resolves instead of guessing.
4. Manual punch editing gains an approval flag: a `user`-role change becomes a pending request
   until an `owner` confirms (pairs with Phase 4).
5. **Acceptance:** an approved 3-day leave removes those days from absence; a holiday is neither
   absent nor overtime; every "missing check-out" row has an owner and a state.

### Phase 4 — Roles, permissions and audit · 4–6 days — **IMPLEMENTED**

> **As built.** `phase4_roles_audit.sql` adds `profiles`, the `current_app_role()` /
> `can_write()` helpers and `audit_log`; the blanket policy is replaced by `_read` (any signed-in
> user) plus `_write` (`can_write()`) on every business table, and biometric templates are
> readable only by writers. Every mutating route writes an audit row with before/after, and
> `audit_log` has no UPDATE/DELETE policy, so history cannot be rewritten even by an owner.
> `/dashboard/users` manages roles (and, since Phase 7, the employee link).
> Deviation still open: reads are not yet scoped by `branch_scope` — see
> `PRODUCTION_READINESS.md` §16. The column and helper exist so it needs no further schema
> change.

1. `profiles` (`user_id → auth.users.id`, `display_name`, `role`
   (`owner` | `admin` | `operator` | `viewer`), `branch_scope text[]`).
2. Replace the blanket `authenticated_full_access` RLS policies with per-table predicates driven
   by `profiles`: reads scoped to `branch_scope`, writes to `admin`/`owner`, punch edits to
   `admin`/`owner`. The ingestion path keeps using the service role.
3. `audit_log` (`actor`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb`, `at`)
   written by every mutating route handler; a read-only viewer screen.
4. UI: user management screen, "read-only" affordances (buttons hidden/disabled by role —
   server-side enforcement is the source of truth, the UI is cosmetic).
5. **Acceptance:** a viewer can read reports and change nothing (verified by API test, not by
   dashboard inspection); every destructive action appears in the audit log with before/after.

### Phase 5 — Reporting pack parity · 5–7 days — **IMPLEMENTED**

> **As built.** `lib/reports/engine.ts` builds all six reports from one column set, so Excel,
> CSV and PDF cannot disagree; `lib/reports/service.ts` caps the range (H7) and says so in the
> output when the cap bites; `lib/reports/exporters.ts` writes the bytes. `/api/reports/run/[type]`
> and `.../export` expose them; the Reports page runs and downloads them. `report_automations`
> gained `report_type` and `cadence`, the cron asks `isDue()` hourly so each rule's own
> `dispatch_time` is finally honoured (M4), and any non-timecard report can be scheduled.
> The legacy monthly branch grid is deliberately preserved for the existing monthly rule.

1. Report set: **monthly summary per employee** (BioTime's "timecard" total row), **exception
   report**, **absence report**, **overtime report**, **department/branch rollup**,
   **late-arrival report**.
2. Shared server-side report engine with a date-range cap and streaming writes (fixes H7 while
   building this), plus a reusable "export column set" so Excel and PDF cannot diverge.
3. Per-report scheduling: extend `report_automations` from "monthly branch dispatch" to
   "any report, any cadence, any recipient", and honour the `dispatch_time` column that the UI
   already exposes but the cron ignores (M4).
4. **Acceptance:** each report reconciles to `attendance_days` in a fixture; a scheduled weekly
   exception report arrives by email.

### Phase 6 — Access control · 10–20 days · **decision required, not a default** — **NOT BUILT**
Doors, zones, anti-passback, interlock, multi-door groups and reader configuration. This is a
different product surface with a different buyer. **Recommendation: do not build it.** If the
customer's terminals are access-control models and the requirement is real, buy BioTime (or a
dedicated access-control product) for that layer and keep this app as the attendance/reporting
system reading the same terminals. Building half of it is worse than not having it.

### Phase 7 — Self-service · 6–10 days · optional — **IMPLEMENTED**
A `viewer`-scoped "my attendance" page (mobile-first), correction requests routed into Phase 3's
exception inbox, and a payslip-hours summary. High perceived value, low technical risk, but
explicitly after Phases 1–4.

> **As built.** `profiles.employee_pin` links a login to exactly one roster row
> (`phase7_self_service.sql`); `/api/me/summary` resolves the pin **from the session, never from
> a parameter**, and `/api/me/corrections` files a correction. `/dashboard/me` is mobile-first:
> month picker, day list with status/in/out/worked/overtime, a payslip-hours summary
> (`lib/attendance/summary.ts`, unit-tested) and the employee's own request history. The sidebar
> now hides operator screens from a viewer.
> Deviation: corrections land in the **Approvals** queue rather than the exceptions inbox — a
> correction *is* a punch change, and Phase 3 already built that queue with the approval path that
> applies it. A second table would mean a second approval screen for the same action.
> Owner action required: link each employee login from `/dashboard/users`.

**Indicative total to "BioTime-equivalent for attendance + provisioning + roles"
(Phases 1–5): ~30–42 developer-days**, i.e. 6–8 focused weeks. Access control is the only piece
that materially changes that estimate, and the recommendation is to buy it instead.

---

### 4.1 Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Attendance rule engine | Implemented — `attendance_engine.sql` |
| 2 | Device provisioning, template safety, H5 state machine | Implemented — `phase2_provisioning.sql` |
| 3 | Leave, holidays, exceptions, approvals | Implemented — `phase3_leave_exceptions.sql` |
| 4 | Roles, per-table RLS, audit log | Implemented — `phase4_roles_audit.sql` |
| 5 | Reporting pack, scheduling (M4), range cap (H7) | Implemented — `phase5_reporting.sql` |
| 6 | Access control (doors, zones, anti-passback) | **Not built — recommendation stands** |
| 7 | Self-service, payslip hours, corrections | Implemented — `phase7_self_service.sql` |

Migrations are additive and idempotent, and are meant to be run in order in the Supabase SQL
editor *after* the code deploys. Until each one is run the corresponding surface degrades rather
than breaks (the reports view falls back to the legacy summary, the device screens ignore the new
columns), which is why deployment order is not fragile.

---

## 5. What "same as BioTime" can never mean here

Be careful with the phrase, because three of BioTime's properties are not reproducible in this
codebase at all:

1. **BioTime's own rule engine semantics.** Even with Phase 1, the numbers will be *your*
   policy engine. The day someone compares a figure to BioTime's output on the same data, any
   disagreement over grace periods or overtime rounding becomes a support incident. **Decide
   which system is authoritative for payroll, in writing, before reconciling.** If BioTime stays
   authoritative, this app should import BioTime's computed results rather than compute its own.
2. **Vendor device management depth.** Firmware upgrade flows, capability negotiation and
   undocumented protocol behaviour change per model. The ADMS push subset implemented here is
   what those terminals expose reliably; the rest is vendor territory.
3. **The commercial product.** Licensing, the desktop client, the mobile app and vendor support
   are not features that can be re-implemented — they are things you either buy or replace
   with your own operational process.

**Recommended positioning:** this app is the **attendance data plane and reporting layer** for
their ZKTeco terminals, with its own policy engine and provisioning — not a BioTime
replacement. Say that in the README so expectations are set once.

---

## 6. Immediate next actions (in order)

1. Apply the security fixes in `secure_rls.sql` and set `ADMS_SECRET_TOKEN` + `CRON_SECRET`
   (see `PRODUCTION_READINESS.md` §12) — Phase 1 should not be built on an open database.
2. Decide §5.1: is this app authoritative for payroll hours, or is BioTime?
3. ✅ **Phase 1 is implemented** (§3.2 cross-midnight fix included, with tests). To turn it on:
   apply `attendance_engine.sql`, run the backfill
   (`POST /api/attendance/recompute { "start": "…", "end": "…" }`), spot-check, then optionally
   run `attendance_engine_switch_view.sql` so the exports read the engine too. Then move to
   **Phase 3 (leave & holidays)** — it is the natural next step now that the evaluator already
   accepts a leave input, and holidays are already wired — before Phase 2, unless the customer
   is blocked on pushing employees to the terminal.
4. If the §5.1 decision is that BioTime stays authoritative → build the BioTime import path
   instead and do not switch the reports onto this engine.
