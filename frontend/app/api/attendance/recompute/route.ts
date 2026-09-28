import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES } from '@/lib/auth/roles';
import { recomputeRange, recomputeKeys } from '@/lib/attendance/recompute';

/** Hard cap so a single request cannot try to compute a decade of days. */
const MAX_RANGE_DAYS = 400;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
  );
}

/**
 * Recompute the attendance summary.
 *
 * POST /api/attendance/recompute
 *   { "start": "2026-09-01", "end": "2026-09-30" }            // backfill / rebuild
 *   { "start": "...", "end": "...", "pin": "1001" }           // one employee
 *   { "keys": [{ "pin": "1001", "workDate": "2026-09-01" }] } // explicit keys
 *
 * This is the backfill entry point: run it once per month of history after the
 * Phase 1 migration, then the nightly cron keeps it current.
 */
export async function POST(request: Request) {
  const auth = await requireAuthUser();
  if (!auth.user) return auth.response!;    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json().catch(() => ({}))) as {
      start?: string;
      end?: string;
      pin?: string;
      keys?: { pin?: string; workDate?: string }[];
    };

    // Explicit keys path.
    if (Array.isArray(body.keys) && body.keys.length > 0) {
      const keys = body.keys
        .filter((k) => typeof k?.pin === 'string' && DATE_RE.test(String(k?.workDate)))
        .map((k) => ({ pin: String(k.pin), workDate: String(k.workDate) }));

      if (keys.length === 0) {
        return NextResponse.json({ error: 'No valid keys supplied' }, { status: 400 });
      }

      const result = await recomputeKeys(supabase, keys);
      return NextResponse.json({ success: true, ...result });
    }

    const start = body.start;
    const end = body.end;

    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json(
        { error: 'Provide start and end as YYYY-MM-DD (or a keys array).' },
        { status: 400 },
      );
    }

    if (end < start) {
      return NextResponse.json({ error: 'end must not be before start' }, { status: 400 });
    }

    if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Range is too large; the maximum is ${MAX_RANGE_DAYS} days.` },
        { status: 413 },
      );
    }

    const result = await recomputeRange(supabase, {
      from: start,
      to: end,
      pins: body.pin ? [body.pin] : undefined,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('[Attendance] recompute failed:', error);
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
