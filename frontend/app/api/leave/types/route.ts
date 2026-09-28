import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';

export async function GET() {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { data, error } = await supabase.from('leave_types').select('*').order('name');
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
            name?: string;
            paid?: boolean;
            requires_approval?: boolean;
            accrual_per_year?: number;
        };

        const name = body.name?.trim();
        if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

        const { data, error } = await supabase
            .from('leave_types')
            .insert([
                {
                    name,
                    paid: body.paid ?? true,
                    requires_approval: body.requires_approval ?? true,
                    accrual_per_year: Number(body.accrual_per_year) || 0,
                },
            ])
            .select()
            .single();

        if (error) {
            // 23505 = unique violation on the name.
            const status = error.code === '23505' ? 409 : 500;
            return NextResponse.json({ error: error.message }, { status });
        }

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'leave_type.create',
            entity: 'leave_types',
            entityId: (data as { id?: string })?.id ?? null,
            after: data,
        });

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

        const { error } = await supabase.from('leave_types').delete().eq('id', id);
        if (error) {
            // 23503 = foreign key violation: the type is in use by a request.
            const status = error.code === '23503' ? 409 : 500;
            const message =
                error.code === '23503'
                    ? 'This leave type is used by existing requests and cannot be deleted.'
                    : error.message;
            return NextResponse.json({ error: message }, { status });
        }

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'leave_type.delete',
            entity: 'leave_types',
            entityId: id,
        });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
