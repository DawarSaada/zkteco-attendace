import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET() {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from('employees').select('*').order('full_name');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
}

export async function POST(request: Request) {
    try {
        const supabase = createAdminClient();
        const body = await request.json();
        const { pin, full_name, department, designation } = body;
        const { data, error } = await supabase
            .from('employees')
            .upsert({ pin, full_name, department, designation }, { onConflict: 'pin' })
            .select();
        
        if (error) throw error;
        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
