import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Punch mutations.
 *
 * Extracted from `app/api/attendance/manual` so the same code applies an edit
 * whether an admin made it directly or a non-admin's request was approved. If
 * the two paths diverged, an approved change would not necessarily match the
 * direct one — which is exactly the class of bug an approval workflow must not
 * have.
 */

export type PunchAction = 'add' | 'edit' | 'delete';

export interface PunchChangePayload {
  action: PunchAction;
  pin: string;
  timestamp?: string;
  old_timestamp?: string;
  id?: string;
  status?: string;
  verify_mode?: string;
  work_code?: number;
}

export interface AppliedPunch {
  pin: string;
  timestamp: string;
}

export type ApplyResult =
  | { ok: true; punches: AppliedPunch[] }
  | { ok: false; error: string; status: number };

export async function applyPunchChange(
  supabase: SupabaseClient,
  payload: PunchChangePayload,
  actorId: string,
): Promise<ApplyResult> {
  const { action, pin } = payload;

  if (!pin) return { ok: false, error: 'Missing pin', status: 400 };

  if (action === 'add') {
    if (!payload.timestamp) return { ok: false, error: 'Missing timestamp', status: 400 };
    const isoTimestamp = new Date(payload.timestamp).toISOString();
    if (Number.isNaN(Date.parse(isoTimestamp))) {
      return { ok: false, error: 'Invalid timestamp', status: 400 };
    }

    await supabase
      .from('employees')
      .upsert({ pin, full_name: `Employee ${pin}` }, { onConflict: 'pin', ignoreDuplicates: true });

    const insertPayload: Record<string, unknown> = {
      pin,
      timestamp: isoTimestamp,
      status: String(payload.status ?? '0'),
      verify_mode: String(payload.verify_mode ?? '0'),
      work_code: Number(payload.work_code) || 0,
      sn: null,
      is_manual: true,
      edited_by: actorId,
    };

    const { error } = await supabase.from('attendance_logs').insert([insertPayload]);
    if (error) {
      // Older schemas may lack the audit columns; retry without them.
      const fallback = { ...insertPayload };
      delete fallback.is_manual;
      delete fallback.edited_by;
      const { error: fallbackError } = await supabase.from('attendance_logs').insert([fallback]);
      if (fallbackError) return { ok: false, error: fallbackError.message, status: 500 };
    }

    return { ok: true, punches: [{ pin, timestamp: isoTimestamp }] };
  }

  if (action === 'edit') {
    if (!payload.timestamp) return { ok: false, error: 'Missing updated timestamp', status: 400 };
    const newIso = new Date(payload.timestamp).toISOString();
    if (Number.isNaN(Date.parse(newIso))) {
      return { ok: false, error: 'Invalid timestamp', status: 400 };
    }

    const updatePayload: Record<string, unknown> = {
      timestamp: newIso,
      is_manual: true,
      edited_by: actorId,
    };
    if (payload.status !== undefined) updatePayload.status = String(payload.status);
    if (payload.work_code !== undefined) updatePayload.work_code = Number(payload.work_code);

    const applyQuery = (columns: Record<string, unknown>) => {
      let query = supabase.from('attendance_logs').update(columns);
      if (payload.id) query = query.eq('id', payload.id);
      else if (payload.old_timestamp) {
        query = query.eq('pin', pin).eq('timestamp', payload.old_timestamp);
      }
      return query;
    };

    if (!payload.id && !payload.old_timestamp) {
      return { ok: false, error: 'Missing log identifier (id or old_timestamp)', status: 400 };
    }

    const { error } = await applyQuery(updatePayload);
    if (error) {
      const fallback: Record<string, unknown> = { timestamp: newIso };
      if (payload.status !== undefined) fallback.status = String(payload.status);
      const { error: fallbackError } = await applyQuery(fallback);
      if (fallbackError) return { ok: false, error: fallbackError.message, status: 500 };
    }

    const punches: AppliedPunch[] = [{ pin, timestamp: newIso }];
    if (payload.old_timestamp) punches.push({ pin, timestamp: payload.old_timestamp });
    return { ok: true, punches };
  }

  // delete
  let query = supabase.from('attendance_logs').delete();
  if (payload.id) query = query.eq('id', payload.id);
  else if (payload.timestamp) query = query.eq('pin', pin).eq('timestamp', payload.timestamp);
  else return { ok: false, error: 'Missing identifier to delete', status: 400 };

  const { error } = await query;
  if (error) return { ok: false, error: error.message, status: 500 };

  return {
    ok: true,
    punches: payload.timestamp ? [{ pin, timestamp: payload.timestamp }] : [],
  };
}
