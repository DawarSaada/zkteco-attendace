# Production Readiness Assessment & Remediation Plan

**Project:** ZKTeco / BioTime-Pro Attendance Dashboard (`D:\Apps\zkteco-attendance-dashboard`)
**Stack:** Next.js 16.3.2 (App Router, Turbopack) · React 19.2.8 · TypeScript strict · Tailwind v4 · Supabase (Postgres + Auth + Realtime) · Vercel (cron + hosting) · Resend / Nodemailer
**Assessed:** 2026-09-25 · branch `main` · working tree clean
**Verdict: NOT production ready.** 8 blockers, 10 high-severity items.

---

## 1. Verified evidence (what I actually ran)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ passes, 0 errors |
| Build | `npm run build` | ✅ succeeds, 24 routes |
| Lint | `npm run lint` | ❌ **fails: 29 errors, 12 warnings** |
| Dependency audit | `npm audit --omit=dev` | ❌ **1 critical, 3 high** |
| Test suite | — | ❌ **none exists** (0 test files, no `test` script) |
| Error boundaries | — | ❌ none (`error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx` all missing) |
| Middleware | — | ❌ **no root `middleware.ts`** |

---

## 2. What is already solid

Credit where due — this is a real, working application, not a prototype:

- Strict TypeScript passes; production build is clean and fast (14.9s).
- Every admin API route is gated by a server-side `requireAuthUser()` guard (`frontend/lib/auth-guard.ts`) — 8/8 routes.
- The dashboard layout performs a real server-side `supabase.auth.getUser()` check before rendering.
- Data writes go through server routes using the service-role client, never the browser.
- `UNIQUE(sn, pin, timestamp)` on `attendance_logs` gives idempotent ingestion — devices can safely resend.
- Manual edits carry an audit trail (`is_manual`, `edited_by`) and have a graceful schema fallback.
- B-tree indexes exist for the hot query paths (timestamp, pin+timestamp, branch).
- Batch upserts in the ingestion path (one write per device poll, not per punch).
- i18n (EN/AR) with full RTL, dark mode with no-FOUC bootstrap, responsive sidebar/drawer.
- Payroll cycle math (26th → 25th) is correct, including the Saudi UTC+3 offset in the cron.
- Cron schedule `0 5 * * *` = 08:00 AST is correctly expressed in `vercel.json`.

---

## 3. BLOCKERS (P0) — must be fixed before any real traffic

### B1. The public anon key currently grants full read/write access to the entire database

**Evidence**
- `database_schema.sql:144-165` — all 8 tables get `CREATE POLICY "Enable all access for all users" ... FOR ALL USING (true)`. There is **no `TO` clause**, so the policy applies to the `public` role, which includes `anon`.
- `database_schema.sql:185` — `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, anon, service_role, postgres;`
- `frontend/lib/supabase/client.ts:6` ships `NEXT_PUBLIC_SUPABASE_ANON_KEY` into the browser bundle (by design, that is what it is for).

**Impact:** anyone who opens DevTools, or simply reads the anon key from the JS bundle, can `select`, `insert`, `update` and `delete` every employee, device, attendance log, shift and automation rule — and exfiltrate the full workforce dataset — without ever logging in. This is the single most serious problem in the codebase.

**Fix**
1. Revoke the blanket grants: `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;`
2. Drop the `USING (true)` policies and replace with role-scoped policies (`TO authenticated`) plus a real authorization predicate.
3. Stop reading attendance/employee data from the browser entirely — see B3.
4. Add a deploy-time assertion that no table in `public` has a policy with a bare `USING (true)` for `anon`.

### B2. The reporting view bypasses RLS and is granted to `anon`

**Evidence**
- `database_schema.sql:108` — `CREATE OR REPLACE VIEW public.daily_attendance_summary AS ...`
- `database_schema.sql:186` — `GRANT SELECT ON public.daily_attendance_summary TO authenticated, anon, service_role, postgres;`

**Impact:** Postgres 15+ creates views as **security-definer** unless `security_invoker = true` is set. Because the view is owned by the migration role, querying it runs with the owner's privileges and **skips the RLS policies on `attendance_logs`/`employees`/`devices`**. Granting `SELECT` to `anon` therefore leaks the entire attendance history even if B1 is fixed.

**Fix**
```sql
ALTER VIEW public.daily_attendance_summary SET (security_invoker = true);
REVOKE SELECT ON public.daily_attendance_summary FROM anon;
```

### B3. `secure_rls.sql` is both incomplete and incompatible with the app

**Evidence**
- `secure_rls.sql` only touches `devices`, `employees`, `attendance_logs`. It leaves `device_commands`, `shifts`, `employee_shifts`, `report_automations`, `report_automation_logs` on their original wide-open `USING (true)` policies from `database_schema.sql`.
- It also has no `WITH CHECK` and no ownership/branch predicate — every authenticated user gets unrestricted access to everything.
- Meanwhile three pages read Supabase **directly from the browser with the anon key**:
  - `frontend/app/dashboard/live/page.tsx:27` (tables + realtime channel)
  - `frontend/app/dashboard/devices/page.tsx:20` (tables + realtime channel)
  - `frontend/app/dashboard/shifts/page.tsx:18` (tables + writes)

**Impact:** the two states are mutually exclusive. Today the app works *because* the database is wide open. The moment `secure_rls.sql` is applied, `/dashboard/live`, `/dashboard/devices` and `/dashboard/shifts` break (empty tables, realtime subscription refused). Whoever deploys next will pick one of two bad outcomes.

**Fix:** finish the RLS model and move those three pages off the browser client onto server routes (which already exist for devices/employees), so no browser code depends on table-level grants.

### B4. Device ingestion endpoints fail **open**, not closed

**Evidence** — identical helper in all three ADMS routes:
- `frontend/app/api/iclock/cdata/route.ts:13-14`
- `frontend/app/api/iclock/getrequest/route.ts:13-14`
- `frontend/app/api/iclock/devicecmd/route.ts:13-14`

```ts
const expectedToken = process.env.ADMS_SECRET_TOKEN;
if (!expectedToken) return true; // Allow if unconfigured (backwards compatibility)
```

**Impact:** `ADMS_SECRET_TOKEN` is **not present in `frontend/.env.local`** and **not documented in `.env.example`**. So in every environment today, `isAuthorized()` returns `true` for every caller. Anyone on the internet can POST fabricated ATTLOG lines to `/api/iclock/cdata` — creating fake employees (`User <pin>`) and fake punches that flow straight into payroll reports. They can also poll `/api/iclock/getrequest` to drain queued device commands and `devicecmd` to forge acknowledgements. Note the comment says "fail-closed" but the code does the opposite.

**Fix:** fail closed when unset (or refuse to boot), make the token mandatory, and add it to `.env.example` + the deployment checklist. Consider also locking ingestion down by device IP allowlist.

### B5. A critical, unauthenticated RCE ships in this dependency set

**Evidence:** `npm audit --omit=dev`

```
next  16.0.0 - 16.3.2   CRITICAL
  Next.js: Unauthenticated Remote Code Execution on windows-hosted servers  (GHSA-p293-qw3h-jr36)
  Next.js: Unauthenticated RCE in Image Optimization API (AVIF)             (GHSA-2xp9-vwfh-vxw4)
nodemailer <=9.1.0      HIGH      (4 advisories, incl. allow-list bypass → attacker-controlled delivery)
sharp  <0.35.4          HIGH      (libheif)
xlsx   *                HIGH      (prototype pollution + ReDoS) — **no fix available on npm**
```

**Impact:** unauthenticated RCE is disqualifying on its own. The nodemailer advisories are directly relevant — this app sends payroll reports to configured recipients and the domain-bypass bug means a crafted address can redirect delivery.

**Fix**
1. Bump `next` to `>=16.3.6` (and `eslint-config-next` to match).
2. Bump `nodemailer`; re-run `npm audit` until only `xlsx` remains.
3. Replace `xlsx@0.18.5` with `exceljs` — see H6.
4. Add a CI job that fails on `npm audit --audit-level=high`.

### B6. There is no middleware, so `lib/supabase/middleware.ts` is dead code and sessions never refresh

**Evidence:** `frontend/lib/supabase/middleware.ts` defines `updateSession()`, but there is **no `frontend/middleware.ts`** to import and run it. `git rev-parse` confirms the app root is `frontend/`; the file is orphaned.

**Impact**
- Supabase access tokens live ~1 hour. Without middleware, the refresh-token rotation never happens. `createClient()` in `server.ts:20-27` swallows the "cannot set cookies from a Server Component" error, so nothing renews the session. Users will be silently bounced to `/login` roughly hourly — in a payroll tool used all day, that is a launch-blocking UX defect.
- Route protection today depends entirely on one check in `app/dashboard/layout.tsx`; any new route outside `/dashboard` is unprotected by default.

**Fix — and the trap to avoid:** when you add `middleware.ts`, you **must** exclude the device and cron paths, or you will break ingestion, because ZKTeco terminals have no session cookie and would be 302'd to `/login`:

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/iclock|iclock|api/cron|icon.svg).*)'],
};
```

### B7. `createAdminClient()` silently degrades to the anon key

**Evidence:** `frontend/lib/supabase/server.ts:37`
```ts
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
```

**Impact:** if `SUPABASE_SERVICE_ROLE_KEY` is missing or misnamed in the production environment (an extremely common deployment error), every API route quietly runs as `anon` instead of failing. Today that is masked by the wide-open RLS — it "works". Once RLS is fixed, the app breaks in confusing, hard-to-diagnose ways rather than refusing to start.

**Fix:** throw at module load if the service-role key is absent in production. Remove the fallback.

### B8. The cron endpoint fails open and doubles as an unauthenticated mass-mailer

**Evidence** — `frontend/app/api/cron/monthly-reports/route.ts:36-43`
```ts
const secret = process.env.CRON_SECRET;
if (secret && authHeader !== `Bearer ${secret}` && searchParams.get('secret') !== secret) { ... 401 }
```
`CRON_SECRET` is absent from `frontend/.env.local` and only marked "Optional" in `.env.example`. `vercel.json` declares the cron without a secret.

**Impact:** with the secret unset the guard is skipped entirely, and `?force=true` bypasses the dispatch-day filter. Anyone who knows the URL can trigger a full payroll-report email blast to every configured recipient, repeatedly. Combined with B5's nodemailer advisories, this is an abuse and reputational risk.

**Fix:** require `CRON_SECRET` unconditionally, set it in Vercel (Vercel injects `Authorization: Bearer $CRON_SECRET` automatically), and drop the `?secret=` query-param path (secrets in URLs land in logs).

---

## 4. HIGH (P1) — required at or immediately after launch

### H1. There are no tests at all
Zero test files, no runner, no `test` script. The highest-risk logic is exactly the untested logic: `calculateMinutes` / `formatTotalHours` (overnight wrap), the 26→25 payroll window, the multi-punch merge, sheet-name sanitisation, and month-boundary date ranges. A wrong payroll total is the kind of bug this app exists to avoid.
**Do:** add Vitest. Unit-test `lib/utils/formatTime.ts`, the payroll window (both the `automation` and cron variants must agree), `generateDateRange`, the merge logic, and the ADMS line parser (`cdata`) including malformed/tab-less/bad-date input. Add integration tests for `requireAuthUser` (401 without session) and a smoke test asserting `anon` cannot read `attendance_logs`.

### H2. No error boundaries or loading states
`app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` and `app/loading.tsx` do not exist. Any render throw shows Next's default screen; any slow route shows a blank page. This is a payroll tool — a blank page is indistinguishable from data loss to a user.
**Do:** add `global-error.tsx`, a dashboard-scoped `error.tsx` with a retry button, `not-found.tsx`, and `loading.tsx` skeletons for `/dashboard/*`.

### H3. No security headers
`next.config.ts` is 13 lines with only an `/iclock` rewrite. No CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`.
**Do:** add a `headers()` block. Start with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS with a 1-year max-age, and a restrictive `Permissions-Policy`. Add CSP in report-only mode first, then enforce — note the app relies on one inline `<script>` in `app/layout.tsx` (the theme/no-FOUC bootstrap), so CSP needs a nonce or a hash.

### H4. No rate limiting
`/login` (credential stuffing) and all three `/api/iclock/*` routes (public, unauthenticated, DB-writing) are unlimited. The heartbeat upsert in `cdata` lets an attacker create unbounded device rows.
**Do:** add per-IP limits — tight on `/login` (e.g. 5/min) and on ingestion (per device SN), using Upstash Redis or Vercel's built-in WAF rate limiting. Also reject unknown SNs unless the device is either already registered or explicitly allowed to self-register.

### H5. The device command state machine can strand commands
Two independent defects:
1. `frontend/app/api/iclock/getrequest/route.ts:55` uses `const cmdId = index + 1` as the ADMS command identifier. IDs restart at 1 on every poll, so the device sees the same `ID=1` for different commands and the ID carries no information back to the server.
2. `frontend/app/api/iclock/devicecmd/route.ts:40-48` sets **every** `SENT` row for that SN to `ACKNOWLEDGED`/`FAILED`, regardless of which command the device actually acknowledged. Combined with (1) there is no way to correlate a response to a command.

Also: once a command moves `PENDING → SENT` it is never retried. If the device polls, receives the command, and then reboots before executing, the command is stuck at `SENT` forever and silently never runs — a real risk for "REBOOT" and "DATA QUERY ATTLOG" actions the UI presents as reliable.

**Do:** use the row's own `id` (or a monotonic per-device counter) as the ADMS command ID; parse `ID=` from the device response and update only that row; add `attempts`, `sent_at`, and a reconciliation job that returns commands stuck in `SENT` beyond a timeout to `PENDING` with an attempt cap; surface stuck/failed commands in the devices UI instead of always showing "success" on queue.

### H6. `xlsx@0.18.5` is deprecated with known CVEs and no npm fix
`npm audit` reports `Prototype Pollution in sheetJS` and `ReDoS` with **"No fix available"** — SheetJS stopped publishing to npm after 0.18.5. The package is used in three places (`app/api/reports/export/route.ts`, `lib/reports/generateBranchReportBuffer.ts`). Mitigating factor: all usages are write-only (`XLSX.write`); there is no `XLSX.read` on untrusted input, so exploitable surface is lower than the advisory implies — but shipping an unpatched, abandoned dependency in a payroll system is not a defensible production position.
**Do:** migrate to `exceljs` (actively maintained, on npm). The three call sites are `utils.json_to_sheet` / `sheet_add_aoa` / `write`; the ExcelJS equivalents are straightforward port.

### H7. No pagination, caps, or streaming on report endpoints
`/api/reports/daily`, `/api/reports/export`, `/api/reports/export` and `/api/employees` return everything, unpaginated. The export route additionally builds a **complete calendar grid for every employee for every day in range, entirely in memory, synchronously**. `handleExportPDF` in `app/dashboard/reports/page.tsx` does the same work in the browser with jsPDF for all employees at once.
**Do:** cap the export range (e.g. ≤ 92 days), stream or chunk the workbook, add pagination to the list endpoints. For the client PDF, either delegate to a server route or generate per-employee on demand. Verify a realistic worst case (e.g. 800 employees × 92 days) on a 512 MB serverless function before launch.

### H8. Timezone correctness is accidental, not guaranteed
Device punches arrive as local wall-clock strings and are parsed with `new Date(ts).toISOString()`, which silently interprets them in the **Node process timezone**. On Vercel that is UTC, which happens to make the stored UTC hour equal the device's displayed hour — the convention `formatPunchTime` (`getUTCHours`) then relies on. Manual punches hardcode the same assumption via `${date}T${time}:00Z`. Nothing asserts or documents it, and `daily_attendance_summary` groups on `DATE(timestamp)` (server TZ).
**Do:** make the device timezone an explicit, named config value; parse with an explicit offset rather than relying on process TZ; add a regression test that pins the expected stored UTC value for a known Riyadh timestamp. Document the invariant.

### H9. `.env.example` is gitignored, so it is not actually shipped
`frontend/.gitignore:34` has the blanket `.env*` rule, and `git check-ignore` confirms `frontend/.env.example` is ignored. It is **not tracked**, so a fresh clone gets no environment template.
It is also incomplete: it omits `ADMS_SECRET_TOKEN` (required by B4) and undersells `CRON_SECRET` as optional (required by B8).
**Do:** add `!frontend/.env.example` (or invert the rule to `.env.local`/`.env*.local`), then commit the file with `ADMS_SECRET_TOKEN`, a mandatory `CRON_SECRET`, and comments on where each value comes from.

### H10. There is no operational documentation
- Repo root `README.md` is one line: `# zkteco-attendace` (misspelled, no content).
- `frontend/README.md` is the untouched create-next-app boilerplate.
- Nothing documents: the Supabase project setup (Auth users, Realtime publication, redirect URLs); the **order** in which the SQL files must be run; how to commission a ZKTeco terminal (server address, port 8088, ADMS path, token); what the ADMS command strings mean; or how to rotate the service-role/Resend/VAPID secrets.
**Do:** write a real root README plus `docs/deployment.md` (env table, secret locations, Vercel project settings, cron), `docs/device-commissioning.md`, and `docs/runbook.md` (how to verify ingestion is alive, how to re-run a failed report, how to unlock a stuck command). Note that `database_schema.sql` and `secure_rls.sql` currently conflict, and running `database_schema.sql` again **re-opens the database** — that hazard must be called out in bold.

---

## 5. MEDIUM (P2) — schedule after launch

| # | Item | Evidence / note |
|---|---|---|
| M1 | ~~**Lint fails** with 29 errors / 12 warnings~~ **PARTLY FIXED** | Now **16 errors / 4 warnings** after the UI/UX pass (see §10). Remaining are pre-existing and non-UI: 6 × `no-explicit-any` + 1 × `prefer-const` in API routes/`generateBranchReportBuffer.ts`, and 9 × `react-hooks/set-state-in-effect` on the fetch-on-mount pattern every page uses. Still not gated in CI. |
| M2 | ~~**All animation utilities are no-ops**~~ **FIXED** | `animate-in`, `fade-in`, `zoom-in-95`, `slide-out-*`, `slide-in-from-*` are now implemented natively in `app/globals.css` via `@utility` + keyframes, reading `--tw-duration`/`--tw-ease`, so `duration-150`/`duration-200` work as written. No new dependency was added (notably **not** `tw-animate-css`). |
| M3 | **No authorization model** | Any authenticated Supabase user is a full admin (create/delete employees, edit punches, change automations, reboot devices). No roles, no invites, no admin/user split. `edited_by` records who, but nothing constrains what. |
| M4 | **`dispatch_time` is a lie** | Stored in `report_automations`, settable in the UI, and `vercel.json` hardcodes `0 5 * * *`. The cron filters only on `dispatch_day`; changing the time has zero effect. |
| M5 | **Redundant + unbounded polling** | `live/page.tsx` polls every 4s *and* opens a Realtime channel, and does an extra `employees` lookup per inserted row (N+1). Every open dashboard tab multiplies DB load. |
| M6 | **Triplicated merge logic** | The multi-punch merge is copy-pasted in `app/api/reports/daily/route.ts`, `app/api/reports/export/route.ts`, and `lib/reports/generateBranchReportBuffer.ts`. The view already groups by `(pin, date)`, so much of it is dead. Extract one shared, tested helper. |
| M7 | **No input validation layer** | Request bodies are hand-validated; `body.pin` may be a non-string, date query params are unvalidated. Add `zod` schemas at every route boundary. |
| M8 | ~~**Dead code**~~ **FIXED** | Deleted `frontend/lib/supabase.ts`, `frontend/components/DashboardNav.tsx` (a 1-line re-export shim with no importers). |
| M9 | ~~**Boilerplate assets shipped**~~ **FIXED** | Deleted `public/next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`. `public/icon.svg` is kept (still referenced by the metadata block). |
| M10 | ~~**Accessibility gaps**~~ **FIXED** | New `Modal`/`ConfirmDialog` primitives add `role="dialog"`, `aria-modal`, `aria-labelledby`/`aria-describedby`, a Tab focus trap, Escape handling, body scroll lock and focus restoration. Labels are wired automatically via a `Field` context (no hand-maintained `htmlFor`), tables have `caption` + `scope="col"`, sortable headers expose `aria-sort`, and toasts announce through an `aria-live` region. |
| M11 | **No observability** | No error reporting (Sentry etc.), no structured logging, no `/api/health`, no uptime monitor. Ingestion silence — the worst failure mode — would go unnoticed. ~~The dashboard's `todayPunches` is hardcoded `0`~~ — now computed from `daily_attendance_summary` for real, alongside a last-heartbeat card and a live activity feed (§10). |
| M12 | **No CI, no runtime pin** | No `.github/workflows`, no `engines`/`.nvmrc`. Versioning is inconsistent (`next`/`react` pinned exact, others caret). |
| M13 | **No migration discipline** | Two loose `.sql` files with no versioning or ordering. `database_schema.sql` re-applied after `secure_rls.sql` silently re-opens everything. Move to ordered, idempotent, forward-only migrations. |

---

## 6. Remediation plan

### Phase 0 — Freeze (do first, ~30 min)
1. Treat production as **not shippable**; do not point a real ZKTeco device at it or load real employee data until Phase 1 is done.
2. Rotate the Supabase service-role key and anon/publishable key — they have been sitting in a local `.env.local` alongside a wide-open RLS configuration. Rotate the Resend key too.
3. Add `!frontend/.env.example` to `frontend/.gitignore` and commit the template with the missing variables.

### Phase 1 — Close the data-exposure hole (launch blocker)
1. Write a **forward-only migration** (`0002_harden_rls.sql`) that:
   - `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;`
   - drops every `USING (true)` policy from all 8 tables,
   - sets `security_invoker = true` on `daily_attendance_summary` and revokes `SELECT` from `anon`,
   - creates real `TO authenticated` policies. Start with a single trusted `admin` role/claim if branch hierarchy is not yet modelled, and shape the predicate so it can grow into per-branch scoping.
2. Move the browser clients out of `/dashboard/live`, `/dashboard/devices`, `/dashboard/shifts` onto server routes. Realtime for the live monitor must then be authorised explicitly (scoped JWT or a server-sent-events endpoint reading through the service role) rather than relying on anon table grants.
3. **Delete `secure_rls.sql`** or rename it to `deprecated_...` — leaving two conflicting hardening scripts in the repo is how the hole gets reopened. Call the hazard out in the README.
4. Remove the anon fallback in `createAdminClient()` (server.ts:37) and fail loudly instead.
5. Verify by test: with only the anon key, `SELECT * FROM attendance_logs` and `SELECT * FROM daily_attendance_summary` must both be denied.

### Phase 2 — Session integrity & route protection
1. Add `frontend/middleware.ts` wired to the existing `updateSession()`, with the matcher from B6 that **excludes `/api/iclock`, `/iclock`, `/api/cron`**.
2. Add a manual test: stay signed in > 60 minutes and confirm no logout; confirm a device POST to `/api/iclock/cdata` still returns `OK`.
3. Add defence-in-depth: keep the layout check, and add a `requireAuthUser()` guard to any route added later (consider a lint rule or route-group wrapper so it cannot be forgotten).

### Phase 3 — Harden device ingestion
1. Make `ADMS_SECRET_TOKEN` mandatory and fail closed; document it; confirm terminals are configured with it.
2. Add rate limiting and an SN allowlist to all three `/api/iclock/*` routes.
3. Fix command IDs and `devicecmd` correlation; add `attempts`/`sent_at` and a stuck-command reconciler (H5).
4. Add explicit timezone handling with a pinned regression test (H8).

### Phase 4 — Dependencies & hardening headers
1. Upgrade `next` to `>=16.3.6` + matching `eslint-config-next`; upgrade `nodemailer`.
2. Migrate `xlsx` → `exceljs` (H6).
3. Add the security-headers block to `next.config.ts`, CSP report-only first (H3).
4. Require `CRON_SECRET` and remove the `?secret=` path (B8).

### Phase 5 — Quality gates
1. Add Vitest; write the unit tests in H1.
2. Add `app/global-error.tsx`, `app/error.tsx`, `app/not-found.tsx`, `app/loading.tsx` (H2).
3. Add CI running `tsc --noEmit`, `next build`, `eslint`, `vitest`, `npm audit --audit-level=high`. Fix the existing 29 lint errors so the gate can be turned on.
4. Add `.nvmrc` / `engines`, and normalise dependency version specifiers.

### Phase 6 — Documentation & operations
1. Rewrite the root README; add `docs/deployment.md`, `docs/device-commissioning.md`, `docs/runbook.md` (H10).
2. Add `/api/health` (Supabase reachability + last device heartbeat age) and an uptime monitor; replace the hardcoded `todayPunches` with a real count (M11).
3. Add pagination/range caps (H7); extract the shared merge helper (M6); add `zod` validation (M7); add rate limiting beyond ingestion (H4).
4. Add accessibility passes on the modals (M10) and install the animation plugin (M2).

---

## 7. Definition of done

- [ ] `anon` cannot read or write **any** table or view — verified by test.
- [ ] `daily_attendance_summary` is `security_invoker` and not granted to `anon`.
- [ ] No page performs direct browser table access; Realtime is explicitly authorised.
- [ ] `/api/iclock/*` rejects requests without a valid token (fail closed), and rejects unknown SNs.
- [ ] `npm audit --audit-level=high` is clean.
- [ ] A signed-in user stays signed in for 24h+; unauthenticated access to `/dashboard/*` redirects to `/login`; device ingestion is unaffected by middleware.
- [ ] Device commands are correlated by real ID, retried on timeout, and stuck commands are visible in the UI.
- [ ] `npm run lint`, `tsc --noEmit`, `next build` and the test suite all pass in CI.
- [ ] Error boundaries and loading states exist for all dashboard routes.
- [ ] `CRON_SECRET` is required; `?force=true` cannot be triggered anonymously.
- [ ] Export capped; worst-case export verified within the serverless memory/time limit.
- [ ] README, deployment, commissioning and runbook docs exist; the two-SQL-file hazard is documented.
- [ ] `/api/health` is monitored; a silent-ingestion alert fires if no punch arrives during working hours.

---

## 8. Deployment checklist (once the above is green)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | public by design — **safe only after Phase 1** |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **server only.** Never prefix with `NEXT_PUBLIC_` |
| `ADMS_SECRET_TOKEN` | ✅ | **currently missing entirely** — Phase 3 |
| `CRON_SECRET` | ✅ | currently optional; make mandatory |
| `RESEND_API_KEY` / `RESEND_FROM` | ✅ | from address must be on a verified domain |
| `SMTP_*` | optional | fallback path only |

Also required outside env: Supabase Auth site + redirect URLs configured; `attendance_logs` added to the `supabase_realtime` publication; SQL migrations run **in order** — `database_schema.sql` → `secure_rls.sql` → `attendance_engine.sql` → `phase2_provisioning.sql` → `phase3_leave_exceptions.sql` → `phase4_roles_audit.sql` → `phase5_reporting.sql` → `phase7_self_service.sql` → `device_ingest_stats.sql`; Vercel cron enabled. Per the §18 audit, only the migrations through `phase5`'s tables are currently applied.

---

## 9. Notes on this assessment

- **Nothing has been committed, staged, pushed, or opened as a PR** at any point. The only files added by the assessment pass were this document; §10 records the code changed afterwards by the UI/UX request.
- **Nothing was pushed to GitHub**, as requested.
- `frontend/.env.local` contains live-looking secrets. It is correctly gitignored and **not tracked** — confirmed via `git check-ignore` and `git ls-files`. Those values are not reproduced anywhere in this document.
- `Dawar Inv VAPID Keys.txt` sits in `D:\Apps\` — **outside** this repository's root (`git rev-parse --show-toplevel` = `D:/Apps/zkteco-attendance-dashboard`), so it is not committed here. Worth moving into a secret manager or noting in the runbook regardless.

---

## 10. UI/UX overhaul — delivered

Requested after the assessment: *"proceed and update the whole website UI/UX and make it amazing."*
Scope was the frontend only. **No security item from §3/§4 was addressed here** — the
blockers B1–B8 are still open and the app is still not production ready. See the warning
at the end of this section.

### 10.1 Design foundation — `app/globals.css`

- **Animation utilities now actually animate.** `animate-in`, `animate-out`, `fade-in/out`,
  `zoom-in-95`/`zoom-out-95`, `slide-in-from-{left,right,top,bottom}`, `sheet-in`,
  `stagger-in` and `toast-progress` are implemented with `@utility` + `@keyframes`.
  They read Tailwind's own `--tw-duration` / `--tw-ease`, so the `duration-150` /
  `duration-200` classes already in the markup drive them. Verified in the compiled
  CSS output, not just assumed.
- **Semantic design tokens** (`--surface`, `--line`, `--ink`, `--brand`, `--success`,
  `--danger`, `--warning`, `--info`, `--accent`, `--shadow-card/lift/pop`) exposed through
  `@theme inline`, so light/dark is one class swap on `<html>`. `color-scheme` is set for
  correct native form controls and scrollbars.
- Base layer: keyboard-only `:focus-visible` ring, themed `::selection`, `tabular-nums`
  helper for numeric columns, themed thin scrollbars.
- **`prefers-reduced-motion` is honoured** — animations and transitions collapse.
- A `@media print` `.no-print` helper.

### 10.2 New shared primitives — `components/ui/`

`Button` (8 variants × 5 sizes, loading/icon/trailing-icon, renders as `<button>` or
`next/link`), `Card`/`CardHeader`/`CardBody`/`CardFooter`, `Badge` (7 tones, dot + pulse),
`Field`/`Input`/`Select`/`Textarea`/`Switch` with automatic `id`↔`htmlFor` and
`aria-describedby` wiring, `Table`/`TableCard`/`THead`/`Th`/`Td`/`Tr`/`TBody` (logical
`text-start`/`text-end`, `scope`, `caption`), `Modal` + `ConfirmDialog`, `Toast` +
`ToastProvider` + `useToast`, `EmptyState`, `PageHeader`, `Skeleton`/`TableSkeleton`/
`CardGridSkeleton`/`StatCardSkeleton`, and a `cn()` helper (clsx + tailwind-merge, both
already dependencies but previously unused).

### 10.3 Route boundaries (previously missing entirely)

`app/error.tsx` (retry + escape hatch, shows the digest), `app/global-error.tsx`
(inline-styled because it replaces the root layout), `app/not-found.tsx`,
`app/loading.tsx`, `app/dashboard/loading.tsx` (skeleton shaped like the real pages).

### 10.4 Accessibility

- Modals: `role="dialog"`, `aria-modal`, labelled/described, Tab focus trap, Escape to
  close, body scroll lock, focus restored to the trigger.
- `window.confirm()` removed everywhere — it blocked the event loop, could not be styled or
  translated, and is suppressed by some browsers. Replaced with `ConfirmDialog`.
- Toast region is a persistent `aria-live="polite"` container; errors use `role="alert"`.
- `SkipLink` to `#dashboard-main`; `<main tabIndex={-1}>`.
- `aria-current="page"` on the active nav item, `aria-expanded`/`aria-controls` on the
  mobile menu button, `aria-label`s on every icon-only button, `aria-sort` on sortable
  headers, `<time>` for the header clock, `<dl>` for device facts.
- Mobile drawer: Escape to close + background scroll lock. (A full focus trap was
  deliberately not added here, so it reads as a disclosure rather than a modal dialog.)

### 10.5 Correctness and polish per page

- **Overview**: `todayPunches` is no longer hardcoded `0` — it is summed from
  `daily_attendance_summary` for the current UTC day (matching how `punch_date` is derived),
  plus an "employees active" count, a real **last-heartbeat** card (device + timestamp,
  replacing a static "ADMS Protocol" filler card), and a **Latest Activity** feed that
  reuses the already-fetched employee list instead of an N+1 lookup. The loader now has
  `try/catch/finally` — previously a rejected request left the page on skeletons forever.
  The refresh button spins in place instead of disabling itself.
- **Live**: employee-name cache replaces the per-insert employee query (removing the
  Realtime-path N+1), typed sort comparator (no `any`), a ticking "last updated Ns"
  indicator, staggered row reveal, and a skeleton on first load.
- **Devices**: `Date.now()` was being called during render (non-deterministic renders);
  it is now a 30s heartbeat state value, so online/offline badges refresh themselves.
  Reboot now asks for confirmation. Device facts moved into a description list.
- **Shifts/Employees/Automation/Reports**: `confirm()` → `ConfirmDialog`, inline banners →
  `useToast`, `any` sort comparators → typed ones, empty states + skeletons everywhere,
  `Excel` export no longer assigns to `window.location.href` (clears the
  `no-location-assign-relative-destination` lint warning and keeps the SPA in place),
  PDF export shows a loading state while jsPDF blocks the main thread.
- **`ThemeProvider`** now derives its state from the `<html class="dark">` that the pre-paint
  script already sets, via `useSyncExternalStore` — no state-setting effect, no flash.
- **i18n**: ~130 new EN/AR keys; every hardcoded string found in the dashboard pages
  (device card fields, placeholder text, toast messages, automation cycle copy, error
  strings, aria-labels) is now translated. RTL verified in the browser.

### 10.6 Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — succeeds, 24 routes.
- `npm run lint` — **16 errors / 4 warnings, down from 29 / 12**; no new category introduced.
- Manual browser pass against `next start` with a real session: login, 404, overview, live,
  reports (+ punches modal with Escape), devices (+ reboot confirm), employees, shifts,
  automation — in dark/light and LTR/RTL. Only console output was a transient Supabase
  Realtime websocket reconnect; no React errors or hydration warnings.

> **The UI is now polished; the application is still not safe to expose.** Nothing in §10
> touches the RLS/grant holes (B1–B3), the fail-open device and cron endpoints (B4, B8),
> the critical `next` RCE (B5), the missing middleware (B6) or the anon-key fallback (B7).
> Please treat the UI work as orthogonal to the launch blockers.

---

## 11. UI/UX overhaul, pass 2 — the "aurora" design language

Requested after §10 shipped: *"recreate the whole UI/UX because it looks old style … make it
great."* Direction chosen by the owner: **modern product dark + light** — a near-black layered
canvas, aurora gradient accents (indigo → violet → cyan), and real depth instead of flat borders,
polished in **both** themes. Frontend only; §3/§4 blockers are still open.

### 11.1 Tokens and utilities — `app/globals.css`

Tokens were replaced wholesale. `:root` (light) and `.dark` now define `--canvas` +
`--canvas-glow-1/2` + `--grid-line`, a three-step surface ramp (`--surface`, `--surface-2`,
`--surface-3`, `--surface-sheen`, `--shimmer`), a two-step line ramp, a three-step ink ramp,
the aurora trio (`--accent-1/2/3`), `--brand*`, `--success*` / `--danger*` / `--warning*` /
`--info*` / `--accent*` sets, `--ring`, `--overlay`, `--radius`, a depth ramp
(`--shadow-card` / `--lift` / `--pop`, `--glow`). Dark canvas is `#05070e` on `#0b101c`
surfaces with `#6366f1` / `#8b5cf6` / `#22d3ee` accents.

New `@utility` layer: `sheen-top`, `card-face`, `app-canvas`, `grid-overlay`, `aurora-bg`,
`aurora-text`, `aurora-ring`, `glow-brand`, `glow-current`, `shimmer`, plus `bar-rise`,
`stagger-in` (delay `calc(var(--ui-i,0) * 45ms)`), `orb-drift` / `orb-drift-slow`. The §10
enter/exit/reduced-motion/print utilities are retained.

**`aurora-text` compiles to nothing today** — Tailwind v4 tree-shakes unused `@utility` output
and no component references it yet. That is expected, not a defect.

### 11.2 New primitives

- `Charts.tsx` — dependency-free SVG: `Sparkline`, `BarChart` (CSS-timed `bar-rise`,
  accessible `title` tooltips, collision-aware axis labels), `Donut` (animated
  `stroke-dasharray`, centre label), `ChartLegend` with percentages. `ChartTone` =
  `aurora | brand | success | danger | warning | info`.
- `CountUp.tsx` — `requestAnimationFrame` odometer with `easeOutCubic`; all state updates
  happen inside the rAF callback, so it does not trip `react-hooks/set-state-in-effect`,
  and it honours reduced motion.
- `Avatar.tsx` — deterministic hue per name, four sizes, `initialsFrom`.
- `Backdrop.tsx` — fixed, masked aurora pools + grid, `aria-hidden`.
- `SegmentedControl.tsx` — `aria-pressed` pill group.
- `StatCard.tsx` — `StatCard` (hero), `MetricTile` (insight strip), `TONE_TILE` map.

Every §10 primitive was then restyled onto the same language: `Button.primary` is now
`sheen-top aurora-bg glow-brand`; `Card` is a glass face with an inner top sheen; `Badge`
uses backdrop blur + an optional pulsing dot; `Table` headers are a translucent band of
10px uppercase tracking; `Modal` and `Toast` are blurred translucent surfaces.

### 11.3 Shell and pages

- `Sidebar` — glass rail, aurora `Fingerprint` mark, `aurora-ring` "Pro" badge, active nav
  item painted with `aurora-bg glow-brand`, avatar + ADMS footer. RTL-aware drawer, Escape
  and scroll lock retained.
- `Header` — glass bar, aurora vertical mark, monospace `<time>` clock pill.
- `login` — aurora field with two drifting blobs over a glass card, icon-prefixed fields,
  show/hide password.
- `overview` — hero stat cards with `CountUp` + `Sparkline`, a 14-day attendance-trend
  `BarChart` built from `/api/reports/daily`, a terminal-health `Donut` with legend, an
  avatar activity feed with `stagger-in`, and a `MetricTile` strip.
- `live`, `devices`, `employees`, `shifts` — metric strips, avatars, glass filter cards,
  `stagger-in` row reveals; devices gained a health `Donut` and a `nowTs` state so
  online/offline badges re-evaluate themselves.
- `automation` — metric strip (rules / active / dispatches / recipients), a dispatch-outcome
  `Donut` + legend over the recorded logs, and an empty state when nothing has dispatched.
- `reports` — metric strip (records / total hours / **average hours per employee-day** /
  missing check-outs), a daily-hours `BarChart` with a `h` suffix, and the filters moved into
  a glass card with a `REPORT FILTERS` eyebrow. Sorting, Excel/PDF export and the punch
  audit modal are unchanged.

### 11.4 Verification

- `npx tsc --noEmit` — clean.
- `npm run build` — `✓ Compiled successfully`, 24/24 static pages.
- `npm run lint` — **16 errors / 4 warnings, unchanged from §10**; no new problem.
- Browser pass on `next start` (port 3010) with the live session: overview, live, devices,
  employees, shifts, automation, reports in dark **and** light, plus Arabic RTL — mirrored
  layout, no horizontal overflow, `dir="rtl"` propagated, zero console messages.

> **Still not production ready.** §11 is presentation only. B1–B8 from §3/§4 stand
> untouched, and `xlsx` still has no patched npm release (migrate to `exceljs`).

---

## 12. Blocker remediation — B1 to B8

Fixes applied after §11. Two of the eight are **complete in code but not yet live**, because
both require either a database change or a deployment environment variable that only the owner
can make.

### !! DO THESE TWO THINGS BEFORE DEPLOYING !!

1. **Run `secure_rls.sql` in the Supabase SQL editor.** Without it the database is still wide
   open to the anon key. It is idempotent and safe to re-run.
2. **Set `ADMS_SECRET_TOKEN` and `CRON_SECRET` in Vercel *before* shipping this code.** The
   device endpoints now answer **503** when the token is unset and the cron answers **503** when
   its secret is unset, so deploying without them **stops device ingestion and the monthly
   mailout**. That is the intended fail-closed behaviour, but it is a hard cutover — see B4 for
   the temporary migration flag.

### Status

| # | Item | Status |
|---|---|---|
| B1 | anon had full read/write on every table | **FIXED** — grants revoked, policies scoped `TO authenticated` with `WITH CHECK` |
| B2 | reporting view bypassed RLS and was granted to `anon` | **FIXED** — `security_invoker = true`, `anon` revoked |
| B3 | `secure_rls.sql` incomplete, and pages depended on the open database | **FIXED** — all 8 tables covered; browser reads use the signed-in session (now a real `authenticated` role), not anonymous access |
| B4 | device endpoints failed **open** without `ADMS_SECRET_TOKEN` | **FIXED** — fail closed, constant-time compare, documented in `.env.example` |
| B5 | critical unauthenticated RCE in `next`, plus nodemailer/sharp advisories | **FIXED** — `next` 16.3.2 → 16.3.6, `nodemailer` 9.0.6 → 9.1.1; `npm audit --omit=dev` now reports **only `xlsx`** |
| B6 | no middleware, sessions never refreshed, new routes unprotected | **FIXED** — `proxy.ts` (the Next 16 rename of `middleware.ts`) refreshes the session and guards pages, excluding `/api/iclock`, `/iclock`, `/api/cron` |
| B7 | `createAdminClient()` silently fell back to the anon key | **FIXED** — throws with a specific message for each missing variable |
| B8 | cron failed open, `?secret=` in URLs, `?force=true` bypass | **FIXED** — `CRON_SECRET` mandatory, header-only auth, `?secret=` removed |

### Files touched

- `secure_rls.sql` — rewritten: view `security_invoker`, legacy policies dropped, `anon`
  revoked, one explicit `TO authenticated` policy per table with `USING` **and** `WITH CHECK`,
  plus three verification queries at the bottom.
- `database_schema.sql` — the same lockdown applied to the source of truth, so re-running it no
  longer re-opens the database (that hazard was called out in H10 and is now gone). Policy
  creation collapsed into a loop so a table can never be forgotten.
- `frontend/lib/adms-auth.ts` (new) — one shared `authorizeDeviceRequest()`: token mandatory,
  read from `?token=`, `X-ADMS-Token` or `Authorization: Bearer`, compared with
  `timingSafeEqual`.
- `frontend/app/api/iclock/{cdata,getrequest,devicecmd}/route.ts` — use the shared check and
  `createAdminClient()`; the duplicated local `isAuthorized`/`getSupabase` copies are gone.
- `frontend/proxy.ts` (new) + `frontend/lib/supabase/session.ts` (renamed from
  `lib/supabase/middleware.ts`, which was dead code) — real session refresh; no redirect for
  `/api/*` so routes keep answering JSON 401 instead of HTML.
- `frontend/lib/supabase/server.ts` — `createAdminClient()` fails fast.
- `frontend/app/api/cron/monthly-reports/route.ts` — mandatory secret, header-only, 503 when
  unconfigured.
- `frontend/.gitignore` — `!.env.example`, so the template is finally tracked (H9).
- `frontend/.env.example` — rewritten: `ADMS_SECRET_TOKEN`, mandatory `CRON_SECRET`, the
  temporary `ADMS_ALLOW_UNCONFIGURED` flag, and commissioning instructions.

### Verification (run against `next start`, probes on a scratch port)

| Probe | Result |
|---|---|
| `GET/POST /iclock/cdata`, `/iclock/getrequest`, `devicecmd` with `ADMS_SECRET_TOKEN` unset | **503**, no database call reached |
| Same with the token set but absent/wrong | **401** (query, header and bearer paths all tested) |
| Same with the correct token | **200** via `?token=` **and** via `X-ADMS-Token` |
| `GET /api/cron/monthly-reports` unauthenticated, wrong bearer, and via the old `?secret=` | **401** in all three cases (query-param path confirmed removed) |
| `GET /dashboard` with no session cookie | **307 → /login** |
| `GET /api/devices` with no session | **401 JSON** (not redirected — proxy excludes `/api`) |
| `GET /iclock/cdata` with no session | reaches the route (503/401), i.e. the proxy exclusion works |
| Browser: `/dashboard` with a real session | renders, no redirect loop, session refreshed |
| `npx tsc --noEmit` / `npm run build` / `npm run lint` | clean / 24 routes, `ƒ Proxy (Middleware)` / **16 errors, 3 warnings** (down from 4 warnings) |

### Deliberately NOT done in this pass

- **H4 rate limiting** on `/login` and the ingestion endpoints. The token gate removes anonymous
  abuse; a per-IP limit and a device-SN allowlist are still worthwhile and are cheap to add
  behind Vercel's WAF.
- **H5 device command correlation.** `getrequest` still numbers commands `index + 1` and
  `devicecmd` still acknowledges *every* `SENT` row for the SN. This matters much more once
  Phase 2 of `BIOTIME_PARITY.md` adds real provisioning commands, and should be fixed there.
- **H6 / the last audit finding.** `xlsx@0.18.5` remains (no npm fix exists). Migrate the three
  write-only call sites to `exceljs` — it is the only remaining `npm audit --omit=dev` entry.
- **M3 role model.** Every authenticated user is still a full admin. `secure_rls.sql` says so
  explicitly rather than hiding it; see Phase 4 of `BIOTIME_PARITY.md`.
- **Device SN allowlist.** A terminal with a valid token can still self-register a device row.
  Acceptable while the token is secret; worth tightening if the token is ever shared with a
  subcontractor.

> The database is safe once `secure_rls.sql` is applied, and the two public endpoints are closed
> in code. What remained at this point was one abandoned dependency (`xlsx`), rate limiting, the
> device command state machine, and the complete absence of a role model — i.e. H4, H5, H6 and
> M3. **H5 and M3 are now closed** (Phases 2 and 4 below); H4 (`xlsx` aside) and H6 are still
> open.

---

## 13. Phase 1 of BioTime parity — the attendance rule engine

Implements Phase 1 of [`BIOTIME_PARITY.md`](./BIOTIME_PARITY.md) §4: the `MIN`/`MAX`
per-calendar-day view is replaced by an explicit, tested rule evaluation, and the
**cross-midnight corruption (§3.2) is fixed** — one row per worked shift instead of two.

### Two owner steps before the engine does anything

1. **Run [`attendance_engine.sql`](./attendance_engine.sql) in the Supabase SQL editor.** It is
   additive and idempotent: five new tables, and it backfills `shift_periods` and
   `employee_shift_assignments` from the existing `shifts` / `employee_shifts` rows. It does
   **not** touch the live report view, so it is safe to apply at any time.
2. **Backfill the summary**, e.g.
   `POST /api/attendance/recompute { "start": "2026-01-01", "end": "2026-12-31" }`
   (authenticated). The nightly cron keeps it current from then on. Until the backfill runs,
   the reports page deliberately falls back to the legacy view and the new columns show “—”.

Then, when the numbers look right, run [`attendance_engine_switch_view.sql`](./attendance_engine_switch_view.sql)
to point `daily_attendance_summary` (which the Excel/PDF **exports** read) at the engine too.
That step is optional for the app itself and is reversible.

### What shipped

- **`frontend/lib/attendance/engine.ts`** — pure, I/O-free: work-date resolution (attributes
  each punch to the shift day it belongs to, so a 22:00→06:00 shift’s 02:00 punch belongs to
  the previous day) and `evaluateDay()`, which produces `status`, `expected_minutes`,
  `worked_minutes`, `late_minutes`, `early_leave_minutes`, `overtime_minutes`, `first_in`,
  `last_out` and `punch_count` from punches + shift periods + policy + holiday + leave.
  Statuses: `present | late | absent | leave | holiday | off | incomplete`.
- **Tests** (first in the project): `engine.test.ts` and `acceptance.test.ts`, run with the
  **Node built-in test runner** (`npm test`) — no new dependency, Node 24 strips the types.
  Covers the cross-midnight boundaries (exactly 00:00, the 06:00 end, just past it), period
  gaps, three-period shifts, punches before the first period, grace periods, overtime,
  weekend/holiday/leave, and a **5 employees × 31 days** acceptance fixture with a night shift,
  a holiday, an absence and a late arrival. **37 tests, all passing.**
- **`frontend/lib/attendance/recompute.ts`** — the only DB-touching part. Every loader degrades
  gracefully when the migration has not been applied yet (missing table ⇒ fall back to the flat
  `shifts`/`employee_shifts` columns), so the code can deploy before the SQL is run.
- **Pipeline** — `app/api/iclock/cdata` recomputes the affected `(pin, work_date)` rows right
  after ingest; `app/api/attendance/manual` recomputes on add/edit/delete; a new
  `POST /api/attendance/recompute` rebuilds any range (the backfill path); and a new
  `GET /api/cron/attendance` (mandatory `CRON_SECRET`, `vercel.json` schedule `15 0 * * *`)
  recomputes the last three days nightly.
- **Reports** — `/api/reports/daily` prefers `attendance_days` and returns
  `status`/`late_minutes`/`early_leave_minutes`/`overtime_minutes`; the reports page gained
  Status, Late, Early-leave and Overtime columns plus a **“Only exceptions”** filter, in EN
  and AR.

### Verification

- `npm test` — **37/37 passing** (incl. the cross-midnight and acceptance cases).
- `npx tsc --noEmit` — clean. `npm run build` — succeeds, 26 routes (2 new). `npm run lint` —
  **16 errors / 3 warnings, unchanged**; no new problem.
- Live DB probe (read-only): `attendance_days` and the four other new tables return **404**
  until the migration is applied, and `daily_attendance_summary` still serves 335 rows —
  confirming the fallback path is what runs today.
- Browser pass on `next start`: reports renders the four new columns (showing “—” via the
  fallback) and the “Only exceptions” filter, zero console messages; Arabic RTL renders the new
  headers correctly.

### Not in Phase 1 (by design)

- **Leave** is an accepted input to the engine but there is no `leave_requests` table yet — that
  is Phase 3. Until then the engine only ever sees `holidays`.
- **Overtime approval** (`requires_overtime_approval`) is stored on the policy but not enforced;
  overtime is computed and reported, not gated.
- **Exports** still read the legacy view until `attendance_engine_switch_view.sql` is run, and
  the “only exceptions” filter is client-side. A server-side report engine with a range cap
  and streaming is Phase 5 (and fixes H7).
- **H8 remains:** the whole engine treats the UTC components of a stored timestamp as the device's
  local wall clock (the same convention `formatPunchTime` always used). That is now stated in one
  place at the top of `engine.ts` rather than being accidental, but it is still an assumption.

---

## 14. BioTime parity Phases 2–5 — provisioning, leave, roles, reporting

Implements Phases 2–5 of [`BIOTIME_PARITY.md`](./BIOTIME_PARITY.md) §4. Phase 6 (access control)
is deliberately **not built** — see §4.1 there for the recommendation. Each phase is a separate
additive, idempotent migration; run them in order after deploying the code.

### Migrations (owner-run, in order)

| File | Adds |
| --- | --- |
| [`phase2_provisioning.sql`](./phase2_provisioning.sql) | `device_users`, `device_settings`, `biometric_templates`, command `attempts`/`sent_at` |
| [`phase3_leave_exceptions.sql`](./phase3_leave_exceptions.sql) | `leave_types`, `leave_requests`, `leave_balances`, `punch_change_requests`, `exceptions` |
| [`phase4_roles_audit.sql`](./phase4_roles_audit.sql) | `profiles`, role helper functions, per-command RLS policies, `audit_log` |
| [`phase5_reporting.sql`](./phase5_reporting.sql) | `report_automations.report_type` / `.cadence` |

### What shipped

- **H5 closed.** `lib/adms/commands.ts` builds every device command from a validated payload
  (no UI-assembled strings). `iclock/getrequest` no longer returns `index + 1` as a command id
  and `iclock/devicecmd` no longer acknowledges *every* `SENT` row for a SN: commands carry a
  stable id, an `attempts` count and a `sent_at`, are matched on acknowledgement, and stuck
  `SENT` rows are reconciled. `lib/adms/queue.ts` owns that state machine.
- **Provisioning.** `/dashboard/provisioning` + `/api/devices/provision` push an employee or a
  whole branch, mirror the terminal's user list into `device_users` for a diff view, pull
  fingerprints into `biometric_templates` (restricted to writers by RLS — templates are sensitive
  personal data), and push settings such as verify mode and time sync.
- **Leave, holidays, exceptions.** `/dashboard/leave` manages types, requests, balances and the
  holiday calendar. The recompute pipeline now also generates `exceptions` rows for punch-level
  problems, and the Reports page hosts an Exceptions inbox and an Approvals inbox.
- **M3 closed.** `profiles` + `createAdminClient()`-backed `requireRole()` gate every mutating
  route, and RLS moves from one blanket `authenticated_full_access` policy per table to
  `_read` (any signed-in user) + `_write` (`can_write()`). `audit_log` records before/after for
  every mutating handler and has no UPDATE/DELETE policy, so it is append-only even for an owner.
- **M4 closed.** `lib/reports/schedule.ts` makes the cron (now hourly) ask `isDue()` per rule, so
  the `dispatch_time` the UI always showed is finally honoured, weekly and daily cadences exist,
  and any of the six report types can be scheduled.
- **H7 partially closed.** The shared report engine caps a request at `MAX_RANGE_DAYS` and reports
  `truncated` in the output instead of silently materialising a decade of days.
- **Reports.** `lib/reports/engine.ts` (pure builder + tests), `service.ts` (fetch + cap),
  `exporters.ts` (XLSX/CSV/PDF from one column set), `/api/reports/run/[type]` and
  `.../export`. Six reports: timecard, exceptions, absence, overtime, branch rollup, late.

### Verification

- `npm test` — **53/53 passing** (engine, acceptance fixture, report engine, payslip summary).
- `npx tsc --noEmit` — clean. `npm run build` — succeeds, 38 routes.
- `npm run lint` — **17 errors / 3 warnings**. All of it is pre-existing: four `no-explicit-any`
  sites and thirteen `react-hooks/set-state-in-effect` hits from the app-wide
  `useEffect(() => void load(), [load])` fetch idiom. See §16.

### Not done here

- **`branch_scope` read scoping.** Every reporting table would need a non-null branch and the
  reporting views reworked; `attendance_logs` has no branch at all. The column and
  `current_branch_scope()` exist so this needs no further schema change.
- **Overtime approval** is still stored but not enforced; overtime is computed and reported.

---

## 15. BioTime parity Phase 7 — self-service

Implements Phase 7 of [`BIOTIME_PARITY.md`](./BIOTIME_PARITY.md) §4 on top of Phase 4's roles.

Migrations: [`phase7_self_service.sql`](./phase7_self_service.sql) adds
`profiles.employee_pin` (an FK to `employees.pin`) and `punch_change_requests.source` / `.note`.

### What shipped

- **`/api/me/summary`** resolves the caller's pin **from their own profile**, never from a query
  parameter, so an employee cannot read a colleague's days by guessing a number. It returns the
  month's `attendance_days`, the payslip totals and the caller's own request history.
  `attendance_days` columns are only exposed for the caller's own pin and only the fields the
  page needs.
- **`/api/me/corrections`** files a correction as a `punch_change_requests` row with
  `source = 'self_service'`. An approved correction is applied by the *same* `applyPunchChange()`
  an admin edit uses and recomputed through the same pipeline, so the two paths cannot diverge.
  Guardrails: the date must be within `MAX_LOOKBACK_DAYS` (120) and not in the future, one open
  request per day, and the pin always comes from the profile.
- **`/dashboard/me`** is mobile-first: month picker, day list with status, in/out, worked and
  overtime, a payslip-hours summary card, the employee's own request list and any open
  exceptions. An unlinked login gets an explanation, not an error.
- **`lib/attendance/summary.ts`** is the pure aggregation behind the summary, with its own tests.
- **Role-aware nav.** The sidebar hides operator screens from a `viewer`, who sees Overview and
  My Attendance. Cosmetic only — every admin route still calls `requireRole()`.
- **Linking** happens in `/dashboard/users`: an owner enters an employee PIN against a login.

### Verification

- `npm test` — **53/53** (incl. the six new summary cases). `npx tsc --noEmit` clean;
  `npm run build` succeeds with `/api/me/*` and `/dashboard/me` present.
- Browser pass as an admin on `next start`: the page renders in EN and AR, the unlinked state
  explains itself, and the correction form posts.

---

## 16. Quality gates — lint cleared, CI enforced

`npm run lint` used to report **17 errors / 3 warnings**. It now reports **0 problems**, and
`.github/workflows/ci.yml` gates every pull request (and every push to `main`) on three commands,
all from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npm test`. The job pins Node 24, because
`npm test` runs the `.ts` test files directly and needs Node's stable type stripping (22.18+).

### The 14 `react-hooks/set-state-in-effect` errors

The flagged shape was the app-wide
`const load = useCallback(async () => { …setState… }); useEffect(() => { void load(); }, [load])`.
The loader sets state, and *invoking it synchronously on the effect path* is what the rule rejects.
The loader bodies are unchanged; only the invocation is deferred by one microtask
(`void Promise.resolve().then(load)`), so the updates land in an async continuation — exactly how
every event-handler caller already ran them. The initial `useState(true)` still covers first paint,
so no extra render is added and loading/refresh timing is unchanged. Verified in the browser across
the affected routes: dashboard, reports, devices, live, users, employees, shifts, automation,
provisioning, leave.

Two of the sites were fixed as genuine findings rather than deferred:

- **`app/dashboard/reports/page.tsx`** derived its date window from `rangeType` inside an effect —
  state derived from state, paying a second render on every cycle change. The window is now a pure
  `rangeFor(type, today)` helper applied by the `<Select>`'s own handler. Verified end to end by
  reading the requests the page issues: weekly = Mon 2026-09-28 → Sun 2026-10-04, payroll =
  2026-08-26 → 2026-09-25, daily = a single day, and `custom` still leaves the user's dates alone.
- **`components/LanguageContext.tsx`** wrote both an unused `mounted` flag and the language from a
  mount effect. It now reads a small external store through `useSyncExternalStore`, with `'en'` as
  the server snapshot, so the first client render matches the server's and the language is never
  written back during a render pass. The one remaining effect synchronises `documentElement.dir`
  and `.lang` — a DOM side effect, which is what effects are for.

The three `no-explicit-any` errors are typed. `api/automation` gained a `ReportAutomationRow`
interface for its payload; the two Excel writers now build the sheet with `aoa_to_sheet` +
`sheet_add_json`, because that is the variant whose option type actually carries `origin`
(`json_to_sheet` is `sheet_add_json(null, …)` at runtime). The rewrite was checked byte-for-byte
against the previous construction — identical workbook bytes and identical CSV — because a silently
shifted payroll spreadsheet would be worse than the lint error.

---

## 17. Device data visibility — what each terminal actually delivers

A ZKTeco push terminal sends several different kinds of payload to
`/iclock/cdata`, selected by `?table=`. Only some of them are ingested:

| Table | Carries | Ingested |
| --- | --- | --- |
| `ATTLOG` | every punch | ✅ `attendance_logs` |
| `USERINFO` | the terminal's own user list | ✅ `employees` + `device_users` |
| `FINGERPRINT` / `BIODATA` | biometric templates | ✅ `biometric_templates` |
| `OPERLOG` | every verification attempt, **including denied ones** | ❌ received and discarded |
| `ATTPHOTO` | the photo captured at a punch | ❌ received and discarded |

Discarding is not the dangerous part by itself; discarding **silently** is. The ingest route
always answers `OK` — it must, or a device would treat a failure as "not delivered" and resend
its whole batch — so a table the app ignores left no trace anywhere, and was indistinguishable
from a table the terminal never sent.

### What was added

- **[`device_ingest_stats.sql`](./device_ingest_stats.sql)** — one row per (terminal, table): when
  it was last received, how many payloads and records arrived, how many were stored, how many
  were dropped, and whether the app handles that table at all. Incremented by the
  `record_device_ingest()` SQL function, so two terminals posting at once cannot lose an update.
- **`lib/adms/tables.ts`** — the canonical table list with its `handled` flags, plus
  `classifyIngestCell()` (the one place that decides what a cell means) and `formatAge()`. Pure
  and unit-tested: it is the single source of truth shared by the ingest route, the API and the
  panel, so a table cannot become "handled" in one place and not another.
- **Ingest counters** in `/api/iclock/cdata` for every table, including the ones we discard, plus
  `normalizeTableName()` — a lower-case `?table=attlog` used to fall through every branch and be
  dropped without ever being counted.
- **`/api/devices/ingest-stats`** and **`DeviceDataPanel`** on `/dashboard/devices`.

### How to read the panel

Each terminal lists **every** canonical table, including the ones with nothing to report, because
a missing row would be the very thing that hides a problem. States:

- **Stored** — received and written.
- **Partly stored** — written, with malformed records discarded (the counts show how many).
- **Not ingested** — the terminal sent it, the app discards it. This is the state that used to be
  invisible, and it is why `OPERLOG` and `ATTPHOTO` now appear instead of being absent.
- **Never received** — nothing has arrived for that table yet.
- **Stored (derived)** — shown for any table that has no receipt counter yet, which is every
  table before the migration and, after it, every table the terminal has not pushed since. The
  numbers are inferred from the rows already stored (`ATTLOG` from `attendance_logs`, `USERINFO`
  from `device_users`, `FINGERPRINT` from `biometric_templates`), and a counter, once one exists,
  always wins over the inference. A derived row cannot show a discarded table, because a discarded
  table stores nothing — hence the separate status.

### What this does not fix

`OPERLOG` and `ATTPHOTO` are still **not ingested**. This change makes that measurable and
explicit rather than silent; it does not recover the data already discarded, and it does not stop
new data being discarded. Ingesting them needs a storage decision (an operations-log table; a
bucket for photos, with the privacy consequences that photographs of employees carry) and belongs
with its own change.

Operationally, `DATA QUERY ATTLOG` on the Terminal Console re-sends the terminal's stored log, so
a backfill is possible for anything the terminal still holds — run it **before** `CLEAR LOG`.

### Counters are fail-soft by design

If the statistics write fails — most likely because the migration has not been applied — the
ingest route logs once and carries on. A device must never receive an error from ingestion
because of a bookkeeping failure, or it would resend its entire batch.

---

## 18. Migration audit — what the live project actually has

Probed on 2026-09-28 with the service-role key, read-only, using PostgREST: a `select` against a
missing table answers `PGRST205`, and a `select` of a missing column answers `42703`. No SQL was
executed, and **no credential that can run DDL exists on this machine** — there is no Supabase
access token (`~/.supabase` holds only telemetry), no database password or connection string in any
local `.env`, and the sibling apps in `D:\Apps` point at *different* Supabase projects. Applying
these migrations needs either the SQL editor, the project's database password, or a personal access
token.

| Migration | Object | State |
|---|---|---|
| `phase2_provisioning` | `device_users`, `biometric_templates`, `device_settings`, `device_commands.device_seq` | ❌ missing |
| `phase3_leave_exceptions` | `leave_types`, `leave_requests`, `leave_balances`, `punch_change_requests`, `exceptions` | ❌ missing |
| `phase4_roles_audit` | `profiles`, `audit_log` | ❌ missing |
| `phase5_reporting` | `report_automations`, `report_automation_logs` | ⚠️ tables exist, but `report_type` and `cadence` are missing |
| `phase7_self_service` | `profiles.employee_pin`, `punch_change_requests.source`/`.note` | ❌ missing |
| `device_ingest_stats` | `device_ingest_stats` | ❌ missing |
| `attendance_engine` | `attendance_policies`, `shift_periods`, `employee_shift_assignments`, `holidays`, `attendance_days` | ❌ missing |

So the database is essentially at `database_schema.sql` plus the two `report_automations` tables.
The app degrades rather than breaking — which is exactly why this went unnoticed — but the
consequences are visible in the running app: `GET /api/exceptions` and `GET /api/attendance/approvals`
both answer **500**, the device data panel falls back to its derived mode, `/dashboard/me` reports
"your login is not linked yet" because `profiles.employee_pin` has nowhere to live, and every user
resolves to the fallback role.

Order matters when these are run: `device_ingest_stats.sql` calls `can_write()`, which
`phase4_roles_audit.sql` creates.
