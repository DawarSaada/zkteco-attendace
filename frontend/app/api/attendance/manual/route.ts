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
        return NextResponse.json(data || []);
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

        const isoTimestamp = new Date(timestamp).toISOString();

        // 1. Ensure employee PIN exists in employees table so foreign key constraint does not fail
        await supabase
            .from('employees')
            .upsert({ pin, full_name: `Employee ${pin}` }, { onConflict: 'pin', ignoreDuplicates: true });

        // 2. Try inserting with audit columns (is_manual, edited_by) and nullable sn
        const insertPayload: Record<string, any> = {
            pin,
            timestamp: isoTimestamp,
            status: String(status),
            verify_mode: String(verify_mode),
            work_code: Number(work_code) || 0,
            sn: null,
            is_manual: true,
            edited_by: auth.user.id
        };

        const { data, error } = await supabase
            .from('attendance_logs')
            .insert([insertPayload])
            .select();

        if (error) {
            // Fallback if is_manual / edited_by columns don't exist yet in user's Supabase schema
            console.warn('[Manual Attendance] Insert failed with audit fields, falling back to base schema:', error.message);
            const fallbackPayload = {
                pin,
                timestamp: isoTimestamp,
                status: String(status),
                verify_mode: String(verify_mode),
                sn: null
            };
            const { data: fbData, error: fbError } = await supabase
                .from('attendance_logs')
                .insert([fallbackPayload])
                .select();
            
            if (fbError) throw fbError;
            return NextResponse.json({ success: true, data: fbData });
        }

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        console.error('[Manual Attendance] POST error:', error);
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

        const newIso = new Date(timestamp).toISOString();

        // Try update with audit fields
        let updatePayload: Record<string, any> = {
            timestamp: newIso,
            is_manual: true,
            edited_by: auth.user.id
        };
        if (status !== undefined) updatePayload.status = String(status);
        if (work_code !== undefined) updatePayload.work_code = Number(work_code);

        let query = supabase.from('attendance_logs').update(updatePayload);

        if (id) {
            query = query.eq('id', id);
        } else if (pin && old_timestamp) {
            query = query.eq('pin', pin).eq('timestamp', old_timestamp);
        } else {
            return NextResponse.json({ error: 'Missing log identifier (id or pin+old_timestamp)' }, { status: 400 });
        }

        const { error } = await query;

        if (error) {
            // Fallback update without audit fields if columns don't exist yet
            console.warn('[Manual Attendance] Update failed with audit fields, falling back:', error.message);
            const fbPayload: Record<string, any> = { timestamp: newIso };
            if (status !== undefined) fbPayload.status = String(status);

            let fbQuery = supabase.from('attendance_logs').update(fbPayload);
            if (id) {
                fbQuery = fbQuery.eq('id', id);
            } else if (pin && old_timestamp) {
                fbQuery = fbQuery.eq('pin', pin).eq('timestamp', old_timestamp);
            }
            const { error: fbErr } = await fbQuery;
            if (fbErr) throw fbErr;
        }

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error('[Manual Attendance] PUT error:', error);
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
        console.error('[Manual Attendance] DELETE error:', error);
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
