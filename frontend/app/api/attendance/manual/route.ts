import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';

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

        const startDate = `${date}T00:00:00.000Z`;
        const endDate = `${date}T23:59:59.999Z`;

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

export async function POST(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const body = await request.json();
        const { pin, timestamp, status = '0', verify_mode = '0', work_code = 0 } = body;
        
        if (!pin || !timestamp) {
            return NextResponse.json({ error: 'Missing pin or timestamp' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('attendance_logs')
            .insert([{ 
                pin, 
                timestamp: new Date(timestamp).toISOString(), 
                status: String(status), 
                verify_mode: String(verify_mode), 
                work_code: Number(work_code) || 0, 
                sn: 'MANUAL_ENTRY',
                is_manual: true,
                edited_by: auth.user.id
            }])
            .select();

        if (error) throw error;
        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const body = await request.json();
        const { id, pin, old_timestamp, timestamp, status, work_code } = body;
        
        if (!timestamp) {
            return NextResponse.json({ error: 'Missing updated timestamp' }, { status: 400 });
        }

        let query = supabase
            .from('attendance_logs')
            .update({ 
                timestamp: new Date(timestamp).toISOString(),
                status: status !== undefined ? String(status) : undefined,
                work_code: work_code !== undefined ? Number(work_code) : undefined,
                is_manual: true,
                edited_by: auth.user.id
            });

        if (id) {
            query = query.eq('id', id);
        } else if (pin && old_timestamp) {
            query = query.eq('pin', pin).eq('timestamp', old_timestamp);
        } else {
            return NextResponse.json({ error: 'Missing log identifier (id or pin+old_timestamp)' }, { status: 400 });
        }

        const { error } = await query;
        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const body = await request.json();
        const { id, pin, timestamp } = body;
        
        let query = supabase.from('attendance_logs').delete();

        if (id) {
            query = query.eq('id', id);
        } else if (pin && timestamp) {
            query = query.eq('pin', pin).eq('timestamp', timestamp);
        } else {
            return NextResponse.json({ error: 'Missing identifier to delete' }, { status: 400 });
        }

        const { error } = await query;
        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
