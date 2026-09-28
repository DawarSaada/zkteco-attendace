import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, OPERATE_ROLES } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const state = searchParams.get('state') ?? 'open';
        const kind = searchParams.get('kind');
        const pin = searchParams.get('pin');
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        let query = supabase
            .from('exceptions')
            .select('id, pin, work_date, kind, state, reason_code, note, resolved_at, created_at, employees(full_name, branch, department)')
            .order('work_date', { ascending: false })
            .limit(500);

        if (state !== 'all') query = query.eq('state', state);
        if (kind && kind !== 'all') query = query.eq('kind', kind);
        if (pin && pin !== 'all') query = query.eq('pin', pin);
        if (from) query = query.gte('work_date', from);
        if (to) query = query.lte('work_date', to);

        const { data, error } = await query;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json(
            ((data ?? []) as Record<string, unknown>[]).map((row) => {
                const employee = row.employees as
                    | { full_name?: string; branch?: string; department?: string }
                    | null;
                return {
                    id: row.id,
                    pin: row.pin,
                    work_date: row.work_date,
                    kind: row.kind,
                    state: row.state,
                    reason_code: row.reason_code,
                    note: row.note,
                    resolved_at: row.resolved_at,
                    created_at: row.created_at,
                    full_name: employee?.full_name ?? null,
                    branch: employee?.branch ?? null,
                    department: employee?.department ?? null,
                };
            }),
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

        const roleGuard = await requireRole(supabase, auth.user, OPERATE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json()) as {
            id?: string;
            state?: string;
            reason_code?: string;
            note?: string;
        };

        const { id, state } = body;
        if (!id || !state || !['open', 'resolved', 'ignored'].includes(state)) {
            return NextResponse.json(
                { error: 'id and state (open|resolved|ignored) are required' },
                { status: 400 },
            );
        }

        const { data: before } = await supabase
            .from('exceptions')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (!before) {
            return NextResponse.json({ error: 'Exception not found' }, { status: 404 });
        }

        const { data, error } = await supabase
            .from('exceptions')
            .update({
                state,
                reason_code: body.reason_code ?? (before as { reason_code?: string }).reason_code ?? null,
                note: body.note ?? (before as { note?: string }).note ?? null,
                resolved_by: state === 'open' ? null : auth.user.id,
                resolved_at: state === 'open' ? null : new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: `exception.${state}`,
            entity: 'exceptions',
            entityId: id,
            before,
            after: data,
        });

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
