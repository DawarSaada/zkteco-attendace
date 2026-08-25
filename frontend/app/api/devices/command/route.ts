import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
    try {
        const authClient = await createClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (!user || authError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = createAdminClient();
        const body = await request.json();
        const { sn, command_str } = body;
        
        if (!sn || !command_str) {
            return NextResponse.json({ error: 'Missing SN or command string' }, { status: 400 });
        }

        const { error } = await supabase
            .from('device_commands')
            .insert([{ 
                sn, 
                command_str, 
                status: 'PENDING' 
            }]);

        if (error) throw error;
        
        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
