import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { authorizeDeviceRequest } from '@/lib/adms-auth';
import { recomputeForPunches } from '@/lib/attendance/recompute';
import { normalizeTableName } from '@/lib/adms/tables';
import { recordDeviceIngest } from '@/lib/adms/ingestStats';

// Strict timestamp validator: rejects malformed/corrupted dates
function isValidTimestamp(timestamp: string): boolean {
    if (!timestamp || typeof timestamp !== 'string') return false;
    const d = new Date(timestamp);
    const time = d.getTime();
    if (isNaN(time)) return false;
    const year = d.getFullYear();
    return year >= 2020 && year <= 2050;
}

/**
 * Parse one biometric-template line pushed by the terminal in response to
 * `DATA QUERY FINGERPRINT`.
 *
 * The push protocol is not consistent across models: some emit `PIN=..\tFID=..\tTMP=..`
 * and others emit positional `pin\tfid\tsize\tvalid\t<base64>`. This accepts both.
 * Base64 may contain `=` padding, so the key/value split only treats a leading
 * identifier as a key.
 */
function parseTemplateLine(line: string): {
    pin: string;
    fid: number;
    size: number | null;
    template: string;
} | null {
    if (!line || !line.trim()) return null;

    const kv = new Map<string, string>();
    const positional: string[] = [];

    for (const part of line.split('\t')) {
        const eq = part.indexOf('=');
        if (eq > 0 && /^[A-Za-z_]+$/.test(part.slice(0, eq))) {
            kv.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1));
        } else {
            positional.push(part);
        }
    }

    const pin = (kv.get('PIN') ?? positional[0] ?? '').trim();
    const fidRaw = kv.get('FID') ?? positional[1];
    const sizeRaw = kv.get('SIZE') ?? positional[2];
    const template = (
        kv.get('TMP') ?? kv.get('TEMPLATE') ?? kv.get('CONTENT') ?? positional[positional.length - 1] ?? ''
    ).trim();

    if (!pin || template.length < 8) return null;

    return {
        pin,
        fid: parseInt(fidRaw ?? '0', 10) || 0,
        size: sizeRaw ? parseInt(sizeRaw, 10) || null : null,
        template,
    };
}

export async function GET(request: Request) {
    const auth = authorizeDeviceRequest(request);
    if (!auth.ok) {
        return new NextResponse(`${auth.reason}\n`, { status: auth.status });
    }

    return new NextResponse("OK\n", { status: 200 });
}

export async function POST(request: Request) {
    const auth = authorizeDeviceRequest(request);
    if (!auth.ok) {
        return new NextResponse(`${auth.reason}\n`, { status: auth.status });
    }

    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const SN = searchParams.get('SN') || 'UNKNOWN_DEVICE';
    // Normalised once: the protocol is upper-case in practice, but a lower-case
    // `table=` value used to fall straight through the branches and be discarded.
    const tableName = normalizeTableName(searchParams.get('table'));

    // Ingest counters for `device_ingest_stats`. A table the app does not handle
    // is counted too, so "received and discarded" becomes visible in the
    // dashboard instead of being indistinguishable from "never arrived".
    let receivedRecords = 0;
    let storedRecords = 0;
    
    try {
        // 1. Device heartbeat.
        //    Self-registration is intentional (a new terminal has to announce
        //    itself once before an operator can name it) and is now safe to keep
        //    because the request has already been authenticated with the ADMS
        //    token above — an anonymous caller can no longer create device rows.
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
        const nonEmptyLines = lines.filter((line) => line.trim()).length;

        if (tableName === 'ATTLOG') {
            receivedRecords = nonEmptyLines;
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

            storedRecords = batchLogs.length;

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

                // 4. Recompute the (pin, work_date) summaries these punches can
                //    affect so late/early/absent/overtime stay current. Best-effort:
                //    a failure here must never make the device think ingest failed
                //    (it would just re-send the whole batch), and the nightly cron
                //    recomputes anyway.
                try {
                    await recomputeForPunches(
                        supabase,
                        batchLogs.map((log) => ({ pin: log.pin, timestamp: log.timestamp })),
                    );
                } catch (recomputeError) {
                    console.error('[Ingestion] Attendance recompute failed:', recomputeError);
                }
            }
        } else if (tableName === 'USERINFO') {
            receivedRecords = nonEmptyLines;
            const batchUsers: Array<{ pin: string; full_name: string }> = [];
            // The terminal's own user list, mirrored so the console can diff
            // "what the database says" against "what is actually on the device".
            const deviceUsers: Array<{
                sn: string;
                pin: string;
                name: string;
                privilege: number;
                card: string | null;
                updated_at: string;
            }> = [];
            const seenAt = new Date().toISOString();

            for (const line of lines) {
                if (!line || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    const pin = parts[0].trim();
                    const name = parts[1]?.trim() || `User ${pin}`;
                    const privilege = parseInt(parts[2]?.trim() || '0', 10) || 0;
                    const card = parts[4]?.trim() || null;
                    if (pin) {
                        batchUsers.push({ pin, full_name: name });
                        deviceUsers.push({ sn: SN, pin, name, privilege, card, updated_at: seenAt });
                    }
                }
            }

            storedRecords = batchUsers.length;

            if (batchUsers.length > 0) {
                await supabase
                    .from('employees')
                    .upsert(batchUsers, { onConflict: 'pin' });
            }

            if (deviceUsers.length > 0) {
                const { error: deviceUsersError } = await supabase
                    .from('device_users')
                    .upsert(deviceUsers, { onConflict: 'sn,pin' });
                if (deviceUsersError) {
                    console.error('[Ingestion] device_users upsert error:', deviceUsersError.message);
                }
            }
        } else if (tableName === 'FINGERPRINT' || tableName === 'BIODATA') {
            receivedRecords = nonEmptyLines;
            // Templates pulled with `DATA QUERY FINGERPRINT`. Stored so a dead
            // terminal is not a permanent loss of every enrolment.
            const rows: Array<{
                sn: string;
                pin: string;
                kind: string;
                fid: number;
                size: number | null;
                template: string;
                captured_at: string;
            }> = [];
            const capturedAt = new Date().toISOString();

            for (const line of lines) {
                const parsed = parseTemplateLine(line);
                if (!parsed) continue;
                rows.push({
                    sn: SN,
                    pin: parsed.pin,
                    kind: 'fingerprint',
                    fid: parsed.fid,
                    size: parsed.size,
                    template: parsed.template,
                    captured_at: capturedAt,
                });
            }

            storedRecords = rows.length;

            if (rows.length > 0) {
                const { error: templateError } = await supabase
                    .from('biometric_templates')
                    .upsert(rows, { onConflict: 'sn,pin,kind,fid' });
                if (templateError) {
                    console.error('[Ingestion] biometric_templates upsert error:', templateError.message);
                }
            }
        } else {
            // Anything else the model emits — OPERLOG, ATTPHOTO, or a table we
            // have never heard of. Count it as received and not stored: the
            // device is told "OK" either way (it must not retry), so this counter
            // is the only record that the data ever arrived.
            receivedRecords = nonEmptyLines;
        }

        if (SN && SN !== 'UNKNOWN_DEVICE' && receivedRecords > 0) {
            await recordDeviceIngest(supabase, {
                sn: SN,
                table: tableName,
                records: receivedRecords,
                stored: storedRecords,
            });
        }

        return new NextResponse("OK\n", { status: 200 });
    } catch (err: unknown) {
        console.error('[Ingestion] cdata handler error:', err);
        return new NextResponse("OK\n", { status: 200 });
    }
}
