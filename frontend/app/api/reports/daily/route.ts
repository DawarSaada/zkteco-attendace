import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || new Date().toISOString().split('T')[0];
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('daily_attendance_summary')
        .select('*')
        .gte('punch_date', startDate)
        .lte('punch_date', endDate)
        .order('punch_date', { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
}
