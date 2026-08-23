import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Client with Service Role Key to bypass RLS for data insertion
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Shared security check
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
    
    // Respond with ok to let the device know the server is ready
    return new NextResponse("OK\n", { status: 200 });
}

export async function POST(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }

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
                const pin = parts[0];
                const timestamp = parts[1];
                const status = parts[2] || '0';
                const verifyMode = parts[3] || '0';

                // Ensure the employee PIN exists
                await supabase
                    .from('employees')
                    .upsert({ pin: pin, full_name: `User ${pin}` }, { onConflict: 'pin', ignoreDuplicates: true });

                // Insert into Supabase
                const { error } = await supabase
                    .from('attendance_logs')
                    .insert([{
                        sn: SN,
                        pin: pin,
                        timestamp: new Date(timestamp).toISOString(),
                        status: status,
                        verify_mode: verifyMode
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
                const pin = parts[0];
                const name = parts[1] || `User ${pin}`;
                
                await supabase
                    .from('employees')
                    .upsert({ pin: pin, full_name: name }, { onConflict: 'pin' });
            }
        }
    }

    return new NextResponse("OK\n", { status: 200 });
}
