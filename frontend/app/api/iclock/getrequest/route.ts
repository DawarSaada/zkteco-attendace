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
    if (!expectedToken) return true; // Allow if unconfigured (backwards compatibility)
    
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    return Boolean(token && token === expectedToken);
}

export async function GET(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN');
    
    if (!SN) return new NextResponse("OK\n", { status: 200 });

    try {
        // Fetch PENDING commands for this device
        const { data: commands, error } = await supabase
            .from('device_commands')
            .select('*')
            .eq('sn', SN)
            .eq('status', 'PENDING')
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching device commands:', error.message);
            return new NextResponse("OK\n", { status: 200 });
        }

        if (!commands || commands.length === 0) {
            return new NextResponse("OK\n", { status: 200 });
        }

        let responseString = "";
        const sentIds: string[] = [];

        // Format commands for ADMS: C:<Command ID>:<Command String>
        commands.forEach((cmd, index) => {
            const cmdId = index + 1; 
            const commandText = cmd.command_str || '';
            if (commandText) {
                responseString += `C:${cmdId}:${commandText}\n`;
                sentIds.push(cmd.id);
            }
        });

        if (sentIds.length > 0) {
            // Progression: Transition status from PENDING to SENT
            await supabase
                .from('device_commands')
                .update({ status: 'SENT' })
                .in('id', sentIds);
        }

        return new NextResponse(responseString || "OK\n", { status: 200 });
    } catch (err: unknown) {
        console.error('getrequest handler error:', err);
        return new NextResponse("OK\n", { status: 200 });
    }
}
