import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Supabase client is created per-request to avoid build-time env errors
function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

// Shared security check for ADMS communication
function isAuthorized(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const expectedToken = process.env.ADMS_SECRET_TOKEN;
    
    // If no token is configured on the server, allow everything (for backward compatibility).
    // Otherwise, require a match.
    if (!expectedToken) return true;
    return token === expectedToken;
}

export async function GET(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }
    
    // Respond with OK to let the device know the server is ready
    return new NextResponse("OK\n", { status: 200 });
}

export async function POST(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN');
    const table = searchParams.get('table');
    
    // Update device last active status
    if (SN) {
        await supabase
            .from('devices')
            .upsert({ sn: SN, last_active: new Date().toISOString() }, { onConflict: 'sn' });
    }

    if (table === 'ATTLOG') {
        const rawData = await request.text();
        const lines = rawData.trim().split('\n');
        
        for (const line of lines) {
            if (!line) continue;
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const pin = parts[0].trim();
                const timestamp = parts[1].trim();
                const status = parts[2]?.trim() || '0';
                const verifyMode = parts[3]?.trim() || '0';
                const workCode = parts[4] ? parseInt(parts[4].trim(), 10) || 0 : 0;

                // Ensure the employee PIN exists
                await supabase
                    .from('employees')
                    .upsert({ pin: pin, full_name: `User ${pin}` }, { onConflict: 'pin', ignoreDuplicates: true });

                // Insert into Supabase with work_code
                const { error } = await supabase
                    .from('attendance_logs')
                    .insert([{
                        sn: SN,
                        pin: pin,
                        timestamp: new Date(timestamp).toISOString(),
                        status: status,
                        verify_mode: verifyMode,
                        work_code: workCode
                    }]);

                if (error && error.code !== '23505') { 
                    console.error('Error inserting log:', error.message);
                }
            }
        }
    } else if (table === 'USERINFO') {
        const rawData = await request.text();
        const lines = rawData.trim().split('\n');
        for (const line of lines) {
            if (!line) continue;
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const pin = parts[0].trim();
                const name = parts[1]?.trim() || `User ${pin}`;
                
                await supabase
                    .from('employees')
                    .upsert({ pin: pin, full_name: name }, { onConflict: 'pin' });
            }
        }
    }

    return new NextResponse("OK\n", { status: 200 });
}
