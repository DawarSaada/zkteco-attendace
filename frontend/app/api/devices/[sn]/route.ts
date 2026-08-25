import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';

export async function PUT(request: Request, { params }: { params: Promise<{ sn: string }> }) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const body = await request.json();
        const { name, branch } = body;
        const { sn } = await params;

        const { error } = await supabase
            .from('devices')
            .update({ name, branch })
            .eq('sn', sn);

        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
