import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';

export async function PUT(request: Request, { params }: { params: Promise<{ sn: string }> }) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = await request.json();
        const { name, branch } = body;
        const { sn } = await params;

        const { error } = await supabase
            .from('devices')
            .update({ name, branch })
            .eq('sn', sn);

        if (error) throw error;

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'device.update',
            entity: 'devices',
            entityId: sn,
            after: { name, branch },
        });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
