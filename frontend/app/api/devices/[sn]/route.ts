import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function PUT(request: Request, { params }: { params: Promise<{ sn: string }> }) {
    try {
        const authClient = await createClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (!user || authError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

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
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
