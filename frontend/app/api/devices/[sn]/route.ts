import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PUT(request: Request, { params }: { params: Promise<{ sn: string }> }) {
    const supabase = await createClient();
    
    try {
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
