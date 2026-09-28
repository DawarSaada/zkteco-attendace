import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from '@/lib/auth-guard';

/**
 * Role model.
 *
 * Before Phase 4 every authenticated user was a full admin. Roles live in
 * `profiles` and are enforced in two places:
 *   - here, in the API (`requireRole`), which is the real gate for anything the
 *     server does with the service-role key, and
 *   - in RLS (`can_write()` in `phase4_roles_audit.sql`), which gates the
 *     browser's own writes through the anon key.
 *
 * BOOTSTRAP: while `profiles` is empty the first signed-in user is promoted to
 * `owner` and their profile is written. If the table does not exist at all
 * (migration not applied) the caller is treated as owner — the pre-Phase-4
 * behaviour — so nothing breaks before the SQL is run.
 */

export type AppRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface Profile {
  user_id: string;
  display_name: string | null;
  role: AppRole;
  branch_scope: string[];
  /** Phase 7 — the roster row this login belongs to, when one has been linked. */
  employee_pin: string | null;
}

export const WRITE_ROLES: AppRole[] = ['owner', 'admin'];
export const OPERATE_ROLES: AppRole[] = ['owner', 'admin', 'operator'];

export function canWrite(role: AppRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canOperate(role: AppRole): boolean {
  return role !== 'viewer';
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  role: string;
  branch_scope: string[] | null;
  employee_pin?: string | null;
}

function normalize(row: ProfileRow): Profile {
  const role = (['owner', 'admin', 'operator', 'viewer'] as const).includes(
    row.role as AppRole,
  )
    ? (row.role as AppRole)
    : 'viewer';
  return {
    user_id: row.user_id,
    display_name: row.display_name,
    role,
    branch_scope: Array.isArray(row.branch_scope) ? row.branch_scope : [],
    employee_pin: row.employee_pin ?? null,
  };
}

let warnedMissingTable = false;

export async function getProfile(supabase: SupabaseClient, user: AuthUser): Promise<Profile> {
  // `select('*')` on purpose: a deployment with phase4 applied but phase7 not
  // yet has no `employee_pin` column, and naming it would make every profile
  // read fail — which the code below would mistake for "no profiles table" and
  // re-widen everyone to owner.
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.error(
        '[Roles] The profiles table is missing; treating signed-in users as owner. ' +
          'Apply phase4_roles_audit.sql to enable roles.',
      );
    }
    return {
      user_id: user.id,
      display_name: user.email ?? null,
      role: 'owner',
      branch_scope: [],
      employee_pin: null,
    };
  }

  if (data) return normalize(data as ProfileRow);

  // No profile yet. The very first user to sign in becomes the owner.
  const { count } = await supabase
    .from('profiles')
    .select('user_id', { count: 'exact', head: true });

  if (!count) {
    const { data: created } = await supabase
      .from('profiles')
      .upsert(
        [{ user_id: user.id, display_name: user.email ?? null, role: 'owner' }],
        { onConflict: 'user_id' },
      )
      .select('*')
      .maybeSingle();

    if (created) {
      console.warn(`[Roles] Bootstrapped ${user.email ?? user.id} as the first owner.`);
      return normalize(created as ProfileRow);
    }
  }

  // A profile exists for someone else but not this user: least privilege.
  return {
    user_id: user.id,
    display_name: user.email ?? null,
    role: 'viewer',
    branch_scope: [],
    employee_pin: null,
  };
}

export type RoleGuardResult =
  | { ok: true; profile: Profile }
  | { ok: false; response: NextResponse };

export async function requireRole(
  supabase: SupabaseClient,
  user: AuthUser,
  allowed: AppRole[],
): Promise<RoleGuardResult> {
  const profile = await getProfile(supabase, user);
  if (allowed.includes(profile.role)) return { ok: true, profile };

  return {
    ok: false,
    response: NextResponse.json(
      { error: `Forbidden: this action requires the ${allowed.join(' or ')} role.` },
      { status: 403 },
    ),
  };
}
