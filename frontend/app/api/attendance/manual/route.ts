import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';

export async function POST(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const body = await request.json();
        const { action, pin, timestamp } = body;
        
        if (!pin || !timestamp) {
            return NextResponse.json({ error: 'Missing pin or timestamp' }, { status: 400 });
        }

        if (action === 'delete') {
            const { error } = await supabase
                .from('attendance_logs')
                .delete()
                .eq('pin', pin)
                .eq('timestamp', timestamp);
            if (error) throw error;
        } else if (action === 'add') {
            const { error } = await supabase
                .from('attendance_logs')
                .insert([{ 
                    pin, 
                    timestamp, 
                    status: '0', 
                    verify_mode: '0', 
                    work_code: 0, 
                    sn: 'MANUAL_ENTRY' 
                }]);
            if (error) throw error;
        } else {
            return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const pin = searchParams.get('pin');
        const date = searchParams.get('date');

        if (!pin || !date) {
            return NextResponse.json({ error: 'Missing pin or date parameter' }, { status: 400 });
        }

        const startDate = `${date}T00:00:00Z`;
        const endDate = `${date}T23:59:59Z`;

        const { data, error } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('pin', pin)
            .gte('timestamp', startDate)
            .lte('timestamp', endDate)
            .order('timestamp', { ascending: true });

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json(data);
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
