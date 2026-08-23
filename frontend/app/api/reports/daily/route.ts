import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');
    const pin = searchParams.get('pin');
    const branch = searchParams.get('branch');

    if (!startDate || !endDate) {
        return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
    }

    let query = supabase
        .from('daily_attendance_summary')
        .select('*')
        .gte('punch_date', startDate)
        .lte('punch_date', endDate)
        .order('punch_date', { ascending: false });

    if (pin && pin !== 'all') {
        query = query.eq('pin', pin);
    }
    
    // NOTE: daily_attendance_summary does NOT currently select branch. We need to add branch to the view, or we can filter it if it's there. Wait, I didn't add branch to the view.
    // I need to update the view to include branch.
    // For now, if branch is filtered, we will just rely on the frontend or we MUST join it.
    // I will use a separate step to update the SQL view.
    
    if (branch && branch !== 'all') {
        query = query.eq('branch', branch);
    }

    const { data, error } = await query;

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
}
