import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { DailyAttendanceSummary } from '@/types';

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
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
            .order('punch_date', { ascending: true })
            .order('pin', { ascending: true });

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

        // Merge any split rows for the same employee on the same date (e.g. from different devices/manual punches)
        // This guarantees EXACTLY ONE single row per employee per date with earliest In and latest Out.
        const mergedMap = new Map<string, DailyAttendanceSummary>();
        
        ((data || []) as DailyAttendanceSummary[]).forEach((row) => {
            const key = `${row.pin}_${row.punch_date}`;
            if (!mergedMap.has(key)) {
                mergedMap.set(key, { ...row });
            } else {
                const existing = mergedMap.get(key)!;
                
                // Earliest Check-In
                if (row.check_in) {
                    if (!existing.check_in || new Date(row.check_in) < new Date(existing.check_in)) {
                        existing.check_in = row.check_in;
                    }
                }
                
                // Latest Check-Out
                if (row.check_out) {
                    if (!existing.check_out || new Date(row.check_out) > new Date(existing.check_out)) {
                        existing.check_out = row.check_out;
                    }
                }

                existing.total_punches = (existing.total_punches || 1) + (row.total_punches || 1);
                if (!existing.branch && row.branch) existing.branch = row.branch;
                if (!existing.device_name && row.device_name) existing.device_name = row.device_name;
                if (!existing.full_name && row.full_name) existing.full_name = row.full_name;
                if (!existing.shift_start && row.shift_start) {
                    existing.shift_start = row.shift_start;
                    existing.shift_end = row.shift_end;
                }
            }
        });

        const mergedList = Array.from(mergedMap.values()).sort((a, b) => {
            if (a.punch_date !== b.punch_date) {
                return a.punch_date.localeCompare(b.punch_date);
            }
            return a.pin.localeCompare(b.pin, undefined, { numeric: true });
        });

        return NextResponse.json(mergedList);
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
