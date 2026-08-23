import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
    const supabase = createAdminClient();
    
    try {
        const body = await request.json();
        const { sn, command_str } = body;
        
        if (!sn || !command_str) {
            return NextResponse.json({ error: 'Missing SN or command' }, { status: 400 });
        }

        const { error } = await supabase
            .from('device_commands')
            .insert([{ sn, command_str }]);

        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
