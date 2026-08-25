import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    try {
        const authClient = await createClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (!user || authError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const supabase = createAdminClient();
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
        
        if (branch && branch !== 'all') {
            query = query.eq('branch', branch);
        }

        const { data, error } = await query;

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
    }
}
