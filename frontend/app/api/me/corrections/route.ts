import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { getProfile } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';
import { addDays } from '@/lib/attendance/engine';
import { saudiNow } from '@/lib/reports/schedule';

/**
 * Correction requests.
 *
 * An employee who was marked absent, or whose punch did not register, files a
 * request here. It lands in the same `punch_change_requests` queue an operator's
 * queued edit uses (Phase 3/4), so there is exactly one approval screen and one
 * code path that applies a punch change — an approved correction is applied by
 * `applyPunchChange`, the same function a direct admin edit goes through.
 *
 * Nothing is written to `attendance_logs` here: a request is a request until an
 * owner or admin approves it.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIONS = ['add', 'edit', 'delete'] as const;
type CorrectionAction = (typeof ACTIONS)[number];

/** How far back an employee may ask for a correction. */
const MAX_LOOKBACK_DAYS = 120;

interface RequestRow {
  id: string;
  pin: string;
  work_date: string | null;
  action: string;
  payload: Record<string, unknown>;
  status: string;
  note: string | null;
  source?: string | null;
  created_at: string;
}

export async function GET() {
  const auth = await requireAuthUser();
  if (!auth.user) return auth.response!;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('punch_change_requests')
      .select('id, pin, work_date, action, status, note, payload, created_at')
      .eq('requested_by', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Degrade, don't break: before phase3 has been applied the table does not
    // exist, and "you have no requests yet" is the honest answer either way.
    if (error) {
      if (error.message.includes('schema cache') || error.message.includes('does not exist')) {
        return NextResponse.json([]);
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthUser();
  if (!auth.user) return auth.response!;

  try {
    const supabase = createAdminClient();
    const profile = await getProfile(supabase, auth.user);

    if (!profile.employee_pin) {
      return NextResponse.json(
        {
          error:
            'Your login is not linked to an employee record yet. Ask an owner to link it from the Users screen.',
        },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      work_date?: string;
      action?: string;
      timestamp?: string;
      old_timestamp?: string;
      note?: string;
    };

    const action = body.action as CorrectionAction | undefined;
    const workDate = body.work_date;

    if (!workDate || !DATE_RE.test(workDate)) {
      return NextResponse.json({ error: 'work_date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of ${ACTIONS.join('|')}` },
        { status: 400 },
      );
    }

    const today = saudiNow().dateKey;
    const earliest = addDays(today, -MAX_LOOKBACK_DAYS);
    if (workDate > today) {
      return NextResponse.json({ error: 'You cannot request a correction for a future date' }, { status: 400 });
    }
    if (workDate < earliest) {
      return NextResponse.json(
        { error: `Corrections can only be requested for the last ${MAX_LOOKBACK_DAYS} days` },
        { status: 400 },
      );
    }

    if (action === 'add' || action === 'edit') {
      if (!body.timestamp || Number.isNaN(Date.parse(body.timestamp))) {
        return NextResponse.json({ error: 'A valid timestamp is required' }, { status: 400 });
      }
    }
    if (action === 'edit' && !body.old_timestamp) {
      return NextResponse.json({ error: 'old_timestamp is required to edit a punch' }, { status: 400 });
    }

    const pin = profile.employee_pin;

    // One open request per day: a second identical ask is a mistake, not a signal.
    const { data: existing } = await supabase
      .from('punch_change_requests')
      .select('id, action, status')
      .eq('pin', pin)
      .eq('work_date', workDate)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'You already have a pending correction request for this day.' },
        { status: 409 },
      );
    }

    const payload: Record<string, unknown> = { action, pin };
    if (body.timestamp) payload.timestamp = body.timestamp;
    if (body.old_timestamp) payload.old_timestamp = body.old_timestamp;

    const row: Record<string, unknown> = {
      pin,
      work_date: workDate,
      action,
      payload,
      status: 'pending',
      requested_by: auth.user.id,
      source: 'self_service',
      note: body.note?.trim() ? body.note.trim() : null,
    };

    let { data, error } = await supabase
      .from('punch_change_requests')
      .insert([row])
      .select()
      .single();

    // Fail soft if phase7 has not been applied yet: the request still belongs in
    // the queue, it just cannot be labelled as self-service.
    if (error && error.message.includes('source')) {
      const fallback = { ...row };
      delete fallback.source;
      delete fallback.note;
      const retry = await supabase.from('punch_change_requests').insert([fallback]).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logAudit(supabase, {
      actor: auth.user.id,
      action: 'punch_request.submit',
      entity: 'punch_change_requests',
      entityId: (data as RequestRow | null)?.id ?? null,
      after: data,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
