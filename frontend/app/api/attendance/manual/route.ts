import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
    const supabase = await createClient();
    
    try {
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
                    status: 0, 
                    verify_mode: 0, 
                    work_code: 0, 
                    sn: 'MANUAL_ENTRY' 
                }]);
            if (error) throw error;
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function GET(request: Request) {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const pin = searchParams.get('pin');
    const date = searchParams.get('date');

    if (!pin || !date) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

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
}
