import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase client is created per-request to avoid build-time env errors
function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

// Shared security check
function isAuthorized(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const expectedToken = process.env.ADMS_SECRET_TOKEN;
    
    if (!expectedToken) return true;
    return token === expectedToken;
}

export async function GET(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN');
    
    if (!SN) return new NextResponse("OK\n", { status: 200 });

    // Fetch pending commands for this device
    const { data: commands } = await supabase
        .from('device_commands')
        .select('*')
        .eq('sn', SN)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

    if (!commands || commands.length === 0) {
        return new NextResponse("OK\n", { status: 200 });
    }

    let responseString = "";
    const executedIds: string[] = [];

    // Format commands for ADMS: C:<Command ID>:<Command String>
    commands.forEach((cmd, index) => {
        const cmdId = index + 1; 
        responseString += `C:${cmdId}:${cmd.command}\n`;
        executedIds.push(cmd.id);
    });

    // Mark as executed
    await supabase
        .from('device_commands')
        .update({ status: 'executed' })
        .in('id', executedIds);

    return new NextResponse(responseString || "OK\n", { status: 200 });
}
