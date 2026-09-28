import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, canWrite, OPERATE_ROLES } from '@/lib/auth/roles';
import { applyPunchChange, type PunchChangePayload } from '@/lib/attendance/punchChanges';
import { logAudit } from '@/lib/audit';
import { recomputeForPunches } from '@/lib/attendance/recompute';

/**
 * Manual punch editing.
 *
 * An owner/admin change applies immediately. For an operator it becomes a
 * pending `punch_change_request` that an owner/admin must approve — payroll
 * corrections are exactly the sort of change that should not be silent.
 * A viewer cannot reach this handler at all.
 */

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const pin = searchParams.get('pin');
        const date = searchParams.get('date');

        if (!pin || !date) {
            return NextResponse.json({ error: 'Missing pin or date parameter' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('pin', pin)
            .gte('timestamp', `${date}T00:00:00.000Z`)
            .lte('timestamp', `${date}T23:59:59.999Z`)
            .order('timestamp', { ascending: true });

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json(data || []);
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

async function mutate(request: Request, action: PunchChangePayload['action']) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, OPERATE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json()) as Record<string, unknown>;
        const payload: PunchChangePayload = { ...(body as unknown as PunchChangePayload), action };

        if (!payload.pin) {
            return NextResponse.json({ error: 'Missing pin' }, { status: 400 });
        }

        // Non-admin: queue the change for approval instead of applying it.
        if (!canWrite(roleGuard.profile.role)) {
            const { data, error } = await supabase
                .from('punch_change_requests')
                .insert([
                    {
                        pin: payload.pin,
                        work_date: (body.work_date as string) ?? null,
                        action,
                        payload,
                        status: 'pending',
                        requested_by: auth.user.id,
                    },
                ])
                .select()
                .single();

            if (error) return NextResponse.json({ error: error.message }, { status: 500 });

            await logAudit(supabase, {
                actor: auth.user.id,
                action: `punch.${action}.requested`,
                entity: 'punch_change_requests',
                entityId: (data as { id?: string })?.id ?? null,
                after: payload,
            });

            return NextResponse.json({ success: true, pending: true, data }, { status: 202 });
        }

        const result = await applyPunchChange(supabase, payload, auth.user.id);
        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }

        try {
            await recomputeForPunches(supabase, result.punches);
        } catch (recomputeError) {
            console.error('[Manual Attendance] Recompute failed:', recomputeError);
        }

        await logAudit(supabase, {
            actor: auth.user.id,
            action: `punch.${action}`,
            entity: 'attendance_logs',
            entityId: payload.id ?? null,
            before: action === 'delete' ? payload : undefined,
            after: action === 'delete' ? undefined : payload,
        });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error(`[Manual Attendance] ${action} error:`, error);
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export const POST = (request: Request) => mutate(request, 'add');
export const PUT = (request: Request) => mutate(request, 'edit');
export const DELETE = (request: Request) => mutate(request, 'delete');
