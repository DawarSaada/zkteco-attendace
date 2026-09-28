import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES } from '@/lib/auth/roles';
import { applyPunchChange, type PunchChangePayload } from '@/lib/attendance/punchChanges';
import { logAudit } from '@/lib/audit';
import { recomputeForPunches } from '@/lib/attendance/recompute';

/** Punch edits an operator queued, waiting for an owner/admin decision. */
export async function GET() {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { data, error } = await supabase
            .from('punch_change_requests')
            .select('id, pin, work_date, action, payload, status, source, note, created_at, employees(full_name)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json(
            ((data ?? []) as Record<string, unknown>[]).map((row) => ({
                id: row.id,
                pin: row.pin,
                work_date: row.work_date,
                action: row.action,
                payload: row.payload,
                status: row.status,
                /** Phase 7 — 'self_service' when the employee filed it themselves. */
                source: row.source ?? 'operator',
                note: row.note ?? null,
                created_at: row.created_at,
                full_name: (row.employees as { full_name?: string } | null)?.full_name ?? null,
            })),
        );
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json()) as { id?: string; decision?: string };
        const { id, decision } = body;

        if (!id || !['approve', 'reject'].includes(decision ?? '')) {
            return NextResponse.json(
                { error: 'id and decision (approve|reject) are required' },
                { status: 400 },
            );
        }

        const { data: request_row, error: fetchError } = await supabase
            .from('punch_change_requests')
            .select('*')
            .eq('id', id)
            .eq('status', 'pending')
            .maybeSingle();

        if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
        if (!request_row) {
            return NextResponse.json({ error: 'Pending request not found' }, { status: 404 });
        }

        const row = request_row as {
            id: string;
            action: PunchChangePayload['action'];
            payload: PunchChangePayload;
            pin: string;
        };

        if (decision === 'approve') {
            const result = await applyPunchChange(supabase, row.payload, auth.user.id);
            if (!result.ok) {
                return NextResponse.json({ error: result.error }, { status: result.status });
            }
            try {
                await recomputeForPunches(supabase, result.punches);
            } catch (recomputeError) {
                console.error('[Approvals] Recompute failed:', recomputeError);
            }
        }

        const { error: updateError } = await supabase
            .from('punch_change_requests')
            .update({
                status: decision === 'approve' ? 'approved' : 'rejected',
                decided_by: auth.user.id,
                decided_at: new Date().toISOString(),
            })
            .eq('id', id);

        if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: `punch_request.${decision}`,
            entity: 'punch_change_requests',
            entityId: id,
            before: row,
            after: { status: decision === 'approve' ? 'approved' : 'rejected' },
        });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
