import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';

export async function POST(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
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
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
