import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';
import { recomputeRange } from '@/lib/attendance/recompute';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const from = searchParams.get('from') ?? `${new Date().getUTCFullYear()}-01-01`;
        const to = searchParams.get('to') ?? `${new Date().getUTCFullYear()}-12-31`;

        const { data, error } = await supabase
            .from('holidays')
            .select('*')
            .gte('date', from)
            .lte('date', to)
            .order('date');

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json()) as {
            date?: string;
            name?: string;
            scope?: string;
            is_working_day?: boolean;
        };

        const { date, name } = body;
        if (!date || !DATE_RE.test(date) || !name?.trim()) {
            return NextResponse.json({ error: 'A date (YYYY-MM-DD) and a name are required' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('holidays')
            .upsert(
                [
                    {
                        date,
                        name: name.trim(),
                        scope: body.scope?.trim() || 'all',
                        is_working_day: !!body.is_working_day,
                    },
                ],
                { onConflict: 'date,scope' },
            )
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'holiday.upsert',
            entity: 'holidays',
            entityId: (data as { id?: string })?.id ?? null,
            after: data,
        });

        // A holiday changes whether the day is an absence or overtime.
        await recomputeRange(supabase, { from: date, to: date });

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

        const { data: before } = await supabase
            .from('holidays')
            .select('date')
            .eq('id', id)
            .maybeSingle();

        const { error } = await supabase.from('holidays').delete().eq('id', id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'holiday.delete',
            entity: 'holidays',
            entityId: id,
            before,
        });

        const date = (before as { date?: string } | null)?.date;
        if (date) await recomputeRange(supabase, { from: date, to: date });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
