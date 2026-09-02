import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';

export async function GET() {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { data, error } = await supabase.from('employees').select('*').order('full_name');
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
        const { pin, full_name, department, branch, designation } = body;

        if (!pin || !full_name) {
            return NextResponse.json({ error: 'PIN and Full Name are required' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('employees')
            .upsert({ pin, full_name, department, branch, designation }, { onConflict: 'pin' })
            .select();
        
        if (error) throw error;
        return NextResponse.json(data);
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        let pin = searchParams.get('pin');

        if (!pin) {
            try {
                const body = await request.json();
                pin = body.pin;
            } catch {
                // query param is primary
            }
        }

        if (!pin) {
            return NextResponse.json({ error: 'PIN is required to delete employee' }, { status: 400 });
        }

        // 1. Delete associated employee shift assignments
        await supabase.from('employee_shifts').delete().eq('pin', pin);

        // 2. Delete employee from employees table
        const { error } = await supabase
            .from('employees')
            .delete()
            .eq('pin', pin);

        if (error) throw error;

        return NextResponse.json({ success: true, message: `Employee PIN ${pin} deleted successfully.` });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
