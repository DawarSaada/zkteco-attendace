import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

// Shared fail-closed security check for ADMS communication
function isAuthorized(request: Request): boolean {
    const expectedToken = process.env.ADMS_SECRET_TOKEN;
    if (!expectedToken) return true;
    
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    return Boolean(token && token === expectedToken);
}

export async function POST(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN');

    try {
        const bodyText = await request.text();
        
        // Typical device responses:
        // "ID=1&Return=0&CMD=DATA QUERY ATTLOG"
        // or "ID=1\nReturn=0"
        const isSuccess = bodyText.includes('Return=0') || bodyText.includes('SUCCESS') || bodyText.includes('OK');
        const nextStatus = isSuccess ? 'EXECUTED' : 'FAILED';

        if (SN) {
            // Update any SENT commands for this device to EXECUTED / FAILED
            await supabase
                .from('device_commands')
                .update({ 
                    status: nextStatus,
                    executed_at: new Date().toISOString()
                })
                .eq('sn', SN)
                .eq('status', 'SENT');
        }

        return new NextResponse("OK\n", { status: 200 });
    } catch (err: unknown) {
        console.error('devicecmd handler error:', err);
        return new NextResponse("OK\n", { status: 200 });
    }
}
