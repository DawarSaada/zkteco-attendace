import type { SupabaseClient } from '@supabase/supabase-js';
import { buildQueueEntries, type AdmsCommand, type QueueEntry } from './commands';

/**
 * Device command queue.
 *
 * The protocol identifies a command by the integer ID the server sends in
 * `C:<id>:<command>`, and the device echoes it back as `ID=<n>`. That ID must be
 * stable and unique per SN, which is what `device_seq` provides. Before this,
 * the ID was just the position in the response (`index + 1`), so there was no way
 * to correlate an acknowledgement to a row.
 */

export const MAX_ATTEMPTS = 3;
/** A command still "SENT" after this long is treated as lost. */
export const SENT_TIMEOUT_MS = 5 * 60 * 1000;
const SEQ_WRAP = 9999;
const SEQ_LOOKBACK = 200;

export interface EnqueueResult {
  queued: number;
  skipped: { command: AdmsCommand; error: string }[];
}

/** Reserve `count` unused IDs for this device, in ascending order. */
export async function reserveSequences(
  supabase: SupabaseClient,
  sn: string,
  count: number,
): Promise<number[]> {
  if (count <= 0) return [];

  const { data } = await supabase
    .from('device_commands')
    .select('device_seq')
    .eq('sn', sn)
    .not('device_seq', 'is', null)
    .order('device_seq', { ascending: false })
    .limit(SEQ_LOOKBACK);

  const rows = (data ?? []) as { device_seq: number }[];
  const used = new Set(rows.map((row) => row.device_seq));
  let cursor = rows[0]?.device_seq ?? 0;

  const reserved: number[] = [];
  while (reserved.length < count) {
    cursor = cursor >= SEQ_WRAP ? 1 : cursor + 1;
    if (!used.has(cursor)) {
      used.add(cursor);
      reserved.push(cursor);
    }
  }
  return reserved;
}

/**
 * Validate and queue a batch of typed commands for a device.
 * Invalid commands are skipped and reported rather than failing the whole batch.
 */
export async function enqueueCommands(
  supabase: SupabaseClient,
  sn: string,
  commands: AdmsCommand[],
): Promise<EnqueueResult> {
  const entries: QueueEntry[] = [];
  const skipped: { command: AdmsCommand; error: string }[] = [];

  for (const command of commands) {
    try {
      entries.push(...buildQueueEntries(command));
    } catch (error) {
      skipped.push({
        command,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (entries.length === 0) return { queued: 0, skipped };

  const sequences = await reserveSequences(supabase, sn, entries.length);

  const rows = entries.map((entry, index) => ({
    sn,
    command_str: entry.commandStr,
    payload: entry.payload,
    status: 'PENDING',
    device_seq: sequences[index],
    attempts: 0,
  }));

  const { error } = await supabase.from('device_commands').insert(rows);
  if (error) throw error;

  return { queued: rows.length, skipped };
}

/**
 * Give a second chance to commands the device never acknowledged: a lost reply
 * (terminal rebooted mid-command, network blip) otherwise leaves a row "SENT"
 * forever and the command is never retried. After `MAX_ATTEMPTS` it is failed
 * with a reason, so the console can surface it instead of hiding it.
 */
export async function reconcileStuckCommands(
  supabase: SupabaseClient,
  sn?: string,
): Promise<{ requeued: number; failed: number }> {
  const cutoff = new Date(Date.now() - SENT_TIMEOUT_MS).toISOString();

  let requeueQuery = supabase
    .from('device_commands')
    .update({ status: 'PENDING' })
    .eq('status', 'SENT')
    .lt('sent_at', cutoff)
    .lt('attempts', MAX_ATTEMPTS);
  if (sn) requeueQuery = requeueQuery.eq('sn', sn);
  const requeued = await requeueQuery.select('id');

  let failQuery = supabase
    .from('device_commands')
    .update({ status: 'FAILED', last_error: 'No acknowledgement from the terminal.' })
    .eq('status', 'SENT')
    .lt('sent_at', cutoff)
    .gte('attempts', MAX_ATTEMPTS);
  if (sn) failQuery = failQuery.eq('sn', sn);
  const failed = await failQuery.select('id');

  return {
    requeued: (requeued.data ?? []).length,
    failed: (failed.data ?? []).length,
  };
}
