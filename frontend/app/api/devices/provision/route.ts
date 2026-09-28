import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';
import { enqueueCommands } from '@/lib/adms/queue';
import { AdmsCommandError, type AdmsCommand } from '@/lib/adms/commands';

/**
 * Device console API.
 *
 * GET  ?sn=...   → the database/device diff, recent commands, templates, settings
 * POST { sn, action, ... } → queue provisioning commands
 *
 * Commands are never built from request strings: the caller sends a typed
 * `action`, and the payload builder in `lib/adms/commands.ts` validates it.
 */

interface EmployeeRow {
  pin: string;
  full_name: string | null;
  department: string | null;
  branch: string | null;
}

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const sn = searchParams.get('sn');

        if (!sn) {
            // No device selected: just the list to choose from.
            const { data: devices, error } = await supabase
                .from('devices')
                .select('sn, name, branch, last_active')
                .order('name', { ascending: true });
            if (error) return NextResponse.json({ error: error.message }, { status: 500 });
            return NextResponse.json({ devices: devices ?? [] });
        }

        const [deviceRes, employeesRes, deviceUsersRes, commandsRes, templatesRes, settingsRes] =
            await Promise.all([
                supabase.from('devices').select('sn, name, branch, last_active').eq('sn', sn).maybeSingle(),
                supabase.from('employees').select('pin, full_name, department, branch').order('pin'),
                supabase.from('device_users').select('pin, name, privilege, card, updated_at').eq('sn', sn),
                supabase
                    .from('device_commands')
                    .select('id, command_str, payload, status, device_seq, attempts, sent_at, acked_at, last_error, created_at')
                    .eq('sn', sn)
                    .order('created_at', { ascending: false })
                    .limit(40),
                supabase.from('biometric_templates').select('pin, fid, size, captured_at').eq('sn', sn),
                supabase.from('device_settings').select('key, value, updated_at').eq('sn', sn),
            ]);

        const employees = (employeesRes.data ?? []) as EmployeeRow[];
        const deviceUsers = (deviceUsersRes.data ?? []) as { pin: string; name: string | null }[];
        const templates = (templatesRes.data ?? []) as { pin: string; fid: number }[];

        const onDevice = new Map(deviceUsers.map((user) => [user.pin, user]));
        const inDatabase = new Map(employees.map((employee) => [employee.pin, employee]));

        const missingOnDevice = employees
            .filter((employee) => !onDevice.has(employee.pin))
            .map((employee) => ({
                pin: employee.pin,
                full_name: employee.full_name,
                department: employee.department,
                branch: employee.branch,
            }));

        const orphanedOnDevice = deviceUsers
            .filter((user) => !inDatabase.has(user.pin))
            .map((user) => ({ pin: user.pin, name: user.name }));

        const nameMismatches = employees
            .filter((employee) => {
                const device = onDevice.get(employee.pin);
                if (!device?.name) return false;
                return device.name.trim() !== (employee.full_name ?? '').trim();
            })
            .map((employee) => ({
                pin: employee.pin,
                database_name: employee.full_name,
                device_name: onDevice.get(employee.pin)?.name ?? null,
            }));

        return NextResponse.json({
            device: deviceRes.data ?? { sn, name: null, branch: null, last_active: null },
            summary: {
                employees: employees.length,
                onDevice: deviceUsers.length,
                missingOnDevice: missingOnDevice.length,
                orphanedOnDevice: orphanedOnDevice.length,
                nameMismatches: nameMismatches.length,
                templates: templates.length,
            },
            missingOnDevice,
            orphanedOnDevice,
            nameMismatches,
            commands: commandsRes.data ?? [],
            templates: templatesRes.data ?? [],
            settings: settingsRes.data ?? [],
        });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const body = (await request.json()) as {
            sn?: string;
            action?: string;
            pins?: string[];
            pin?: string;
            branch?: string;
            verifyMode?: number;
            threshold?: number;
            commKey?: number;
            timezone?: number;
            commandId?: string;
        };

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const sn = body.sn?.trim();
        const action = body.action;

        if (!sn || !action) {
            return NextResponse.json({ error: 'Missing sn or action' }, { status: 400 });
        }

        const commands: AdmsCommand[] = [];

        switch (action) {
            case 'reboot':
                commands.push({ kind: 'reboot' });
                break;

            case 'check':
                commands.push({ kind: 'check' });
                break;

            case 'query_attlog':
                commands.push({ kind: 'query_attlog' });
                break;

            case 'clear_log':
                commands.push({ kind: 'clear_log' });
                break;

            case 'set_time':
                commands.push({ kind: 'set_time', at: new Date().toISOString() });
                break;

            case 'set_params': {
                const options: Record<string, string | number> = {};
                if (body.verifyMode !== undefined) options['VerifyMode'] = body.verifyMode;
                if (body.threshold !== undefined) options['MatchThreshold'] = body.threshold;
                if (body.commKey !== undefined) options['CommKey'] = body.commKey;
                if (body.timezone !== undefined) options['TimeZone'] = body.timezone;
                if (Object.keys(options).length === 0) {
                    return NextResponse.json({ error: 'No parameters supplied' }, { status: 400 });
                }
                commands.push({ kind: 'set_options', options });

                // Remember what we pushed so the console can show last-known state.
                await supabase.from('device_settings').upsert(
                    Object.entries(options).map(([key, value]) => ({
                        sn,
                        key,
                        value: String(value),
                        updated_at: new Date().toISOString(),
                    })),
                    { onConflict: 'sn,key' },
                );
                break;
            }

            case 'push_employee':
            case 'push_employees':
            case 'push_branch': {
                let pins = body.pins ?? (body.pin ? [body.pin] : []);

                if (action === 'push_branch' && body.branch) {
                    const { data } = await supabase
                        .from('employees')
                        .select('pin')
                        .eq('branch', body.branch);
                    pins = ((data ?? []) as { pin: string }[]).map((row) => row.pin);
                }

                if (pins.length === 0) {
                    return NextResponse.json({ error: 'No employees selected' }, { status: 400 });
                }

                const { data: employees } = await supabase
                    .from('employees')
                    .select('pin, full_name')
                    .in('pin', pins);

                const rows = (employees ?? []) as { pin: string; full_name: string | null }[];
                if (rows.length === 0) {
                    return NextResponse.json(
                        { error: 'None of the selected PINs exist in the database' },
                        { status: 404 },
                    );
                }

                for (const employee of rows) {
                    commands.push({
                        kind: 'update_userinfo',
                        pin: employee.pin,
                        name: employee.full_name ?? `User ${employee.pin}`,
                        privilege: 0,
                    });
                }
                break;
            }

            case 'delete_user': {
                if (!body.pin) {
                    return NextResponse.json({ error: 'Missing pin' }, { status: 400 });
                }
                commands.push({ kind: 'delete_userinfo', pin: body.pin });
                break;
            }

            case 'pull_templates':
                commands.push(
                    body.pin ? { kind: 'query_fingerprint', pin: body.pin } : { kind: 'query_fingerprint' },
                );
                break;

            case 'restore_templates': {
                let query = supabase
                    .from('biometric_templates')
                    .select('pin, fid, template, kind')
                    .eq('sn', sn);
                if (body.pin) query = query.eq('pin', body.pin);

                const { data } = await query;
                const templates = (data ?? []) as {
                    pin: string;
                    fid: number;
                    template: string;
                    kind: string;
                }[];

                if (templates.length === 0) {
                    return NextResponse.json(
                        { error: 'No backed-up templates for this terminal. Pull them first.' },
                        { status: 404 },
                    );
                }

                for (const template of templates) {
                    if (template.kind !== 'fingerprint') continue;
                    commands.push({
                        kind: 'update_fingerprint',
                        pin: template.pin,
                        fid: template.fid,
                        template: template.template,
                    });
                }
                break;
            }

            case 'retry_command': {
                if (!body.commandId) {
                    return NextResponse.json({ error: 'Missing commandId' }, { status: 400 });
                }
                const { data: existing, error } = await supabase
                    .from('device_commands')
                    .update({ status: 'PENDING', attempts: 0, last_error: null, sent_at: null })
                    .eq('id', body.commandId)
                    .eq('sn', sn)
                    .select('id')
                    .maybeSingle();
                if (error) return NextResponse.json({ error: error.message }, { status: 500 });
                if (!existing) {
                    return NextResponse.json({ error: 'Command not found' }, { status: 404 });
                }
                return NextResponse.json({ success: true, requeued: 1 });
            }

            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }

        const result = await enqueueCommands(supabase, sn, commands);

        await logAudit(supabase, {
            actor: auth.user.id,
            action: `device.provision.${action}`,
            entity: 'device_commands',
            entityId: sn,
            after: { action, queued: result.queued },
        });

        return NextResponse.json({
            success: true,
            queued: result.queued,
            skipped: result.skipped,
        });
    } catch (error: unknown) {
        if (error instanceof AdmsCommandError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
