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

// Strict timestamp validator: rejects malformed/corrupted dates
function isValidTimestamp(timestamp: string): boolean {
    if (!timestamp || typeof timestamp !== 'string') return false;
    const d = new Date(timestamp);
    const time = d.getTime();
    if (isNaN(time)) return false;
    const year = d.getFullYear();
    return year >= 2020 && year <= 2050;
}

export async function GET(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }
    
    return new NextResponse("OK\n", { status: 200 });
}

export async function POST(request: Request) {
    if (!isAuthorized(request)) {
        return new NextResponse("Unauthorized\n", { status: 401 });
    }

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN') || 'UNKNOWN_DEVICE';
    const table = searchParams.get('table');
    
    try {
        // 1. Update device heartbeat
        if (SN && SN !== 'UNKNOWN_DEVICE') {
            await supabase
                .from('devices')
                .upsert({ sn: SN, last_active: new Date().toISOString() }, { onConflict: 'sn' });
        }

        const rawData = await request.text();
        if (!rawData || !rawData.trim()) {
            return new NextResponse("OK\n", { status: 200 });
        }

        const lines = rawData.trim().split('\n');

        if (table === 'ATTLOG') {
            const batchEmployeesMap = new Map<string, { pin: string; full_name: string }>();
            const batchLogs: Array<{
                sn: string;
                pin: string;
                timestamp: string;
                status: string;
                verify_mode: string;
                work_code: number;
                is_manual: boolean;
            }> = [];

            for (const line of lines) {
                if (!line || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const pin = parts[0].trim();
                    const timestampRaw = parts[1].trim();
                    const status = parts[2]?.trim() || '0';
                    const verifyMode = parts[3]?.trim() || '0';
                    const workCode = parts[4] ? parseInt(parts[4].trim(), 10) || 0 : 0;

                    if (!pin || !isValidTimestamp(timestampRaw)) {
                        console.warn(`[Ingestion] Quarantined invalid log entry: ${line}`);
                        continue;
                    }

                    const isoTimestamp = new Date(timestampRaw).toISOString();

                    if (!batchEmployeesMap.has(pin)) {
                        batchEmployeesMap.set(pin, { pin, full_name: `User ${pin}` });
                    }

                    batchLogs.push({
                        sn: SN,
                        pin,
                        timestamp: isoTimestamp,
                        status,
                        verify_mode: verifyMode,
                        work_code: workCode,
                        is_manual: false
                    });
                }
            }

            // 2. Batch Employee Upsert (1 single database write)
            if (batchEmployeesMap.size > 0) {
                const employeesToUpsert = Array.from(batchEmployeesMap.values());
                const { error: empErr } = await supabase
                    .from('employees')
                    .upsert(employeesToUpsert, { onConflict: 'pin', ignoreDuplicates: true });
                if (empErr) console.error('[Ingestion] Batch employee upsert error:', empErr.message);
            }

            // 3. Batch Attendance Logs Insert (1 single database write)
            if (batchLogs.length > 0) {
                const { error: logErr } = await supabase
                    .from('attendance_logs')
                    .upsert(batchLogs, { onConflict: 'sn,pin,timestamp', ignoreDuplicates: true });
                if (logErr && logErr.code !== '23505') {
                    console.error('[Ingestion] Batch log insert error:', logErr.message);
                }
            }
        } else if (table === 'USERINFO') {
            const batchUsers: Array<{ pin: string; full_name: string }> = [];
            for (const line of lines) {
                if (!line || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const pin = parts[0].trim();
                    const name = parts[1]?.trim() || `User ${pin}`;
                    if (pin) {
                        batchUsers.push({ pin, full_name: name });
                    }
                }
            }
            if (batchUsers.length > 0) {
                await supabase
                    .from('employees')
                    .upsert(batchUsers, { onConflict: 'pin' });
            }
        }

        return new NextResponse("OK\n", { status: 200 });
    } catch (err: unknown) {
        console.error('[Ingestion] cdata handler error:', err);
        return new NextResponse("OK\n", { status: 200 });
    }
}
