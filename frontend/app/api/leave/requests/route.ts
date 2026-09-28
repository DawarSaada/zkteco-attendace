import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES, OPERATE_ROLES } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';
import { recomputeRange } from '@/lib/attendance/recompute';

/** Inclusive day count between two `YYYY-MM-DD` dates. */
function daysInclusive(from: string, to: string): number {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
    return Math.round((end - start) / 86400000) + 1;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface LeaveRequestRow {
    id: string;
    pin: string;
    type_id: string;
    from_date: string;
    to_date: string;
    status: string;
    note: string | null;
    decided_at: string | null;
    created_at: string;
}

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const year = Number(searchParams.get('year')) || new Date().getUTCFullYear();
        const status = searchParams.get('status');
        const pin = searchParams.get('pin');

        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;

        let requestsQuery = supabase
            .from('leave_requests')
            .select('id, pin, type_id, from_date, to_date, status, note, decided_at, created_at, leave_types(name), employees(full_name)')
            .lte('from_date', yearEnd)
            .gte('to_date', yearStart)
            .order('from_date', { ascending: false });

        if (status && status !== 'all') requestsQuery = requestsQuery.eq('status', status);
        if (pin && pin !== 'all') requestsQuery = requestsQuery.eq('pin', pin);

        const [typesRes, requestsRes, employeesRes, balancesRes] = await Promise.all([
            supabase.from('leave_types').select('*').order('name'),
            requestsQuery,
            supabase.from('employees').select('pin, full_name, department, branch').order('full_name'),
            supabase.from('leave_balances').select('pin, type_id, year, entitled_days').eq('year', year),
        ]);

        const types = (typesRes.data ?? []) as {
            id: string;
            name: string;
            paid: boolean;
            requires_approval: boolean;
            accrual_per_year: number;
        }[];
        const requests = (requestsRes.data ?? []) as (LeaveRequestRow & {
            leave_types?: { name?: string } | null;
            employees?: { full_name?: string } | null;
        })[];
        const employees = (employeesRes.data ?? []) as {
            pin: string;
            full_name: string | null;
            department: string | null;
            branch: string | null;
        }[];

        // Balances: entitlement from `leave_balances`, usage derived from approved
        // requests so it can never drift from the decision history.
        const entitledMap = new Map<string, number>();
        ((balancesRes.data ?? []) as { pin: string; type_id: string; entitled_days: number }[]).forEach(
            (row) => entitledMap.set(`${row.pin}|${row.type_id}`, Number(row.entitled_days) || 0),
        );

        const usedMap = new Map<string, number>();
        requests
            .filter((row) => row.status === 'approved')
            .forEach((row) => {
                const key = `${row.pin}|${row.type_id}`;
                usedMap.set(key, (usedMap.get(key) ?? 0) + daysInclusive(row.from_date, row.to_date));
            });

        const balances = employees.flatMap((employee) =>
            types.map((type) => {
                const key = `${employee.pin}|${type.id}`;
                const entitled = entitledMap.get(key) ?? (Number(type.accrual_per_year) || 0);
                const used = usedMap.get(key) ?? 0;
                return {
                    pin: employee.pin,
                    full_name: employee.full_name,
                    type_id: type.id,
                    type_name: type.name,
                    year,
                    entitled,
                    used,
                    remaining: entitled - used,
                };
            }),
        );

        return NextResponse.json({
            year,
            types,
            employees,
            balances,
            requests: requests.map((row) => ({
                ...row,
                type_name: row.leave_types?.name ?? null,
                full_name: row.employees?.full_name ?? null,
                days: daysInclusive(row.from_date, row.to_date),
            })),
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

        // Operators may request leave; the approval decision below is stricter.
        const roleGuard = await requireRole(supabase, auth.user, OPERATE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json()) as {
            pin?: string;
            type_id?: string;
            from_date?: string;
            to_date?: string;
            note?: string;
        };

        const { pin, type_id, from_date, to_date } = body;

        if (!pin || !type_id || !from_date || !to_date) {
            return NextResponse.json(
                { error: 'pin, type_id, from_date and to_date are required' },
                { status: 400 },
            );
        }
        if (!DATE_RE.test(from_date) || !DATE_RE.test(to_date)) {
            return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 });
        }
        if (to_date < from_date) {
            return NextResponse.json({ error: 'End date must not be before start date' }, { status: 400 });
        }

        const { data: type } = await supabase
            .from('leave_types')
            .select('id, name, requires_approval')
            .eq('id', type_id)
            .maybeSingle();

        if (!type) {
            return NextResponse.json({ error: 'Unknown leave type' }, { status: 404 });
        }

        // A type that does not require approval is recorded as approved.
        const status = type.requires_approval ? 'pending' : 'approved';

        const { data, error } = await supabase
            .from('leave_requests')
            .insert([
                {
                    pin,
                    type_id,
                    from_date,
                    to_date,
                    status,
                    note: body.note ?? null,
                    requested_by: auth.user.id,
                    decided_by: status === 'approved' ? auth.user.id : null,
                    decided_at: status === 'approved' ? new Date().toISOString() : null,
                },
            ])
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'leave_request.create',
            entity: 'leave_requests',
            entityId: (data as { id?: string })?.id ?? null,
            after: data,
        });

        if (status === 'approved') {
            await recomputeRange(supabase, { from: from_date, to: to_date, pins: [pin] });
        }

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json()) as { id?: string; status?: string };

        const { id, status } = body;
        if (!id || !status || !['approved', 'rejected', 'cancelled'].includes(status)) {
            return NextResponse.json(
                { error: 'id and status (approved|rejected|cancelled) are required' },
                { status: 400 },
            );
        }

        const { data: before } = await supabase
            .from('leave_requests')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (!before) {
            return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
        }

        const { data, error } = await supabase
            .from('leave_requests')
            .update({
                status,
                decided_by: auth.user.id,
                decided_at: new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: `leave_request.${status}`,
            entity: 'leave_requests',
            entityId: id,
            before,
            after: data,
        });

        // A decision changes whether those days are absences, so recompute them.
        const row = data as LeaveRequestRow;
        await recomputeRange(supabase, {
            from: row.from_date,
            to: row.to_date,
            pins: [row.pin],
        });

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
