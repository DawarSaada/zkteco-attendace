import type { SupabaseClient } from '@supabase/supabase-js';
import { isHandledTable, normalizeTableName } from './tables';

/**
 * Record what a terminal just delivered, into `device_ingest_stats`.
 *
 * The `handled` flag is derived from the canonical table list here rather than
 * being passed in by the ingest route: a caller cannot then mark a table we
 * discard as handled, and adding a real handler for OPERLOG means changing one
 * list and having every surface follow.
 *
 * Failure is deliberately non-fatal and logged once. Device ingestion must never
 * start returning an error to a terminal because a statistics write failed — the
 * device would treat that as "not delivered" and resend the whole batch. When the
 * migration has not been applied yet, the panel says so and falls back to
 * deriving what it can from the stored rows.
 */

let warnedMissingFunction = false;

export interface IngestOutcome {
  sn: string;
  table: string;
  /** Records (lines) the terminal sent for this table. */
  records: number;
  /** Records actually written to the database. */
  stored: number;
}

export async function recordDeviceIngest(
  supabase: SupabaseClient,
  outcome: IngestOutcome,
): Promise<void> {
  const table = normalizeTableName(outcome.table);
  const records = Math.max(0, outcome.records);
  const stored = Math.max(0, Math.min(outcome.stored, records));

  try {
    const { error } = await supabase.rpc('record_device_ingest', {
      p_sn: outcome.sn,
      p_table: table,
      p_records: records,
      p_stored: stored,
      p_dropped: records - stored,
      p_handled: isHandledTable(table),
    });

    if (error && !warnedMissingFunction) {
      warnedMissingFunction = true;
      console.error(
        `[Ingest] Could not record ingest statistics (${error.message}). ` +
          'Run device_ingest_stats.sql to enable the device data panel.',
      );
    }
  } catch (error) {
    if (!warnedMissingFunction) {
      warnedMissingFunction = true;
      console.error('[Ingest] Could not record ingest statistics:', error);
    }
  }
}
