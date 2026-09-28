import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Audit log.
 *
 * Every mutating route handler calls this so a destructive or payroll-affecting
 * action leaves a record: who did it, to what, with before/after values.
 *
 * It is deliberately fail-soft: an audit write must never fail the operation the
 * user asked for. If the `audit_log` table is missing (migration not applied) or
 * the insert fails, it logs to the server console and moves on. The absence of
 * audit rows is itself visible in the UI, so it cannot be silently ignored.
 */

export interface AuditEntry {
  actor: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function logAudit(supabase: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabase.from('audit_log').insert([
      {
        actor: entry.actor,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
      },
    ]);
    if (error) {
      console.error('[Audit] Failed to write audit_log:', error.message);
    }
  } catch (error) {
    console.error('[Audit] Unexpected audit failure:', error);
  }
}
