import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { requireRole, WRITE_ROLES, type AppRole } from '@/lib/auth/roles';
import { logAudit } from '@/lib/audit';

const ROLES: AppRole[] = ['owner', 'admin', 'operator', 'viewer'];

/**
 * User management.
 *
 * `profiles` holds the role; `auth.users` holds the credentials. Both are needed
 * for a usable screen, so the GET merges them through the admin API (service
 * role) — which means this endpoint must stay behind a role check.
 */
export async function GET() {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, WRITE_ROLES);
        if (!roleGuard.ok) return roleGuard.response;

        const [usersResult, profilesResult, auditResult] = await Promise.all([
            supabase.auth.admin.listUsers({ page: 1, perPage: 200 }),
            supabase.from('profiles').select('*'),
            supabase
                .from('audit_log')
                .select('id, actor, action, entity, entity_id, before, after, at')
                .order('at', { ascending: false })
                .limit(100),
        ]);

        const users = usersResult.data?.users ?? [];
        const profiles = (profilesResult.data ?? []) as {
            user_id: string;
            display_name: string | null;
            role: string;
            branch_scope: string[] | null;
            employee_pin?: string | null;
            created_at: string;
        }[];

        const profileMap = new Map(profiles.map((profile) => [profile.user_id, profile]));

        return NextResponse.json({
            users: users.map((user) => {
                const profile = profileMap.get(user.id);
                return {
                    user_id: user.id,
                    email: user.email ?? null,
                    last_sign_in_at: user.last_sign_in_at ?? null,
                    created_at: user.created_at,
                    display_name: profile?.display_name ?? null,
                    role: profile?.role ?? null,
                    branch_scope: profile?.branch_scope ?? [],
                    employee_pin: profile?.employee_pin ?? null,
                };
            }),
            currentUserId: auth.user.id,
            currentRole: roleGuard.profile.role,
            currentEmployeePin: roleGuard.profile.employee_pin,
            audit: auditResult.data ?? [],
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

        // Only an owner may change roles.
        const roleGuard = await requireRole(supabase, auth.user, ['owner']);
        if (!roleGuard.ok) return roleGuard.response;

        const body = (await request.json()) as {
            user_id?: string;
            role?: string;
            display_name?: string;
            branch_scope?: string[];
            employee_pin?: string | null;
        };

        const { user_id, role } = body;
        if (!user_id || !role || !ROLES.includes(role as AppRole)) {
            return NextResponse.json(
                { error: `user_id and role (${ROLES.join('|')}) are required` },
                { status: 400 },
            );
        }

        // Phase 7: linking a login to a roster row is what gives that login a
        // "my attendance" page, so the pin must actually exist.
        const employeePin =
            typeof body.employee_pin === 'string' && body.employee_pin.trim()
                ? body.employee_pin.trim()
                : null;

        if (employeePin) {
            const { data: employee } = await supabase
                .from('employees')
                .select('pin')
                .eq('pin', employeePin)
                .maybeSingle();

            if (!employee) {
                return NextResponse.json(
                    { error: `No employee with PIN ${employeePin}` },
                    { status: 400 },
                );
            }
        }

        const { data: before } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', user_id)
            .maybeSingle();

        const { data, error } = await supabase
            .from('profiles')
            .upsert(
                [
                    {
                        user_id,
                        role,
                        display_name: body.display_name ?? null,
                        branch_scope: Array.isArray(body.branch_scope) ? body.branch_scope : [],
                        employee_pin: employeePin,
                        updated_at: new Date().toISOString(),
                    },
                ],
                { onConflict: 'user_id' },
            )
            .select()
            .single();

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'profile.set_role',
            entity: 'profiles',
            entityId: user_id,
            before,
            after: data,
        });

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const roleGuard = await requireRole(supabase, auth.user, ['owner']);
        if (!roleGuard.ok) return roleGuard.response;

        const { searchParams } = new URL(request.url);
        const user_id = searchParams.get('user_id');
        if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 });

        if (user_id === auth.user.id) {
            return NextResponse.json({ error: 'You cannot remove your own role.' }, { status: 400 });
        }

        const { data: before } = await supabase
            .from('profiles')
            .select('*')
            .eq('user_id', user_id)
            .maybeSingle();

        const { error } = await supabase.from('profiles').delete().eq('user_id', user_id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        await logAudit(supabase, {
            actor: auth.user.id,
            action: 'profile.remove_role',
            entity: 'profiles',
            entityId: user_id,
            before,
        });

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
