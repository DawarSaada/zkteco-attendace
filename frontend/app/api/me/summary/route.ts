import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { getProfile } from '@/lib/auth/roles';
import { summariseDays, type PayslipDayInput } from '@/lib/attendance/summary';
import { saudiNow } from '@/lib/reports/schedule';

/**
 * "My attendance" — the self-service feed.
 *
 * The pin comes from the caller's own profile and nowhere else: there is no
 * `?pin=` parameter, so an employee cannot read a colleague's days by guessing
 * a number. An unlinked login gets `linked: false` and an empty payload rather
 * than an error, because the page has to render an explanation either way.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function monthBounds(): { from: string; to: string } {
  const today = saudiNow().dateKey;
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export async function GET(request: Request) {
  const auth = await requireAuthUser();
  if (!auth.user) return auth.response!;

  try {
    const supabase = createAdminClient();
    const profile = await getProfile(supabase, auth.user);

    const { searchParams } = new URL(request.url);
    const fallback = monthBounds();
    const from = DATE_RE.test(searchParams.get('from') ?? '')
      ? (searchParams.get('from') as string)
      : fallback.from;
    const to = DATE_RE.test(searchParams.get('to') ?? '')
      ? (searchParams.get('to') as string)
      : fallback.to;

    if (!profile.employee_pin) {
      return NextResponse.json({
        linked: false,
        profile: {
          display_name: profile.display_name,
          role: profile.role,
          employee_pin: null,
        },
        range: { from, to },
      });
    }

    const pin = profile.employee_pin;

    const [employeeRes, daysRes, shiftRes, requestsRes, exceptionRes] = await Promise.all([
      supabase
        .from('employees')
        .select('pin, full_name, branch, department')
        .eq('pin', pin)
        .maybeSingle(),
      supabase
        .from('attendance_days')
        .select(
          'work_date, status, expected_minutes, worked_minutes, late_minutes, early_leave_minutes, overtime_minutes, first_in, last_out, punch_count',
        )
        .eq('pin', pin)
        .gte('work_date', from)
        .lte('work_date', to)
        .order('work_date', { ascending: false }),
      supabase
        .from('employee_shifts')
        .select('shifts(name, start_time, end_time)')
        .eq('pin', pin)
        .maybeSingle(),
      supabase
        .from('punch_change_requests')
        .select('id, work_date, action, status, note, payload, created_at')
        .eq('requested_by', auth.user.id)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('exceptions')
        .select('id, work_date, kind, state')
        .eq('pin', pin)
        .eq('state', 'open')
        .order('work_date', { ascending: false })
        .limit(20),
    ]);

    const days = (daysRes.data ?? []) as PayslipDayInput[];
    const summary = summariseDays(days);

    const shiftRow = shiftRes.data as
      | { shifts?: { name?: string; start_time?: string; end_time?: string } | null }
      | null;

    return NextResponse.json({
      linked: true,
      profile: {
        display_name: profile.display_name,
        role: profile.role,
        employee_pin: pin,
      },
      employee: employeeRes.data ?? { pin, full_name: null, branch: null, department: null },
      shift: shiftRow?.shifts ?? null,
      range: { from, to },
      summary,
      // `attendance_days` may not be backfilled yet; `engineApplied` lets the page
      // say so instead of implying the employee had no attendance at all.
      engineApplied: !daysRes.error,
      days,
      requests: requestsRes.data ?? [],
      openExceptions: exceptionRes.data ?? [],
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
