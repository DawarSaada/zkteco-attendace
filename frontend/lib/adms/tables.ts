/**
 * The ADMS tables a terminal can push, and how to read the ingest statistics.
 *
 * Pure and dependency-free on purpose: the ingest route, the stats API and the
 * data panel all need to agree on (a) which tables are expected, (b) whether we
 * actually ingest each one, and (c) what a statistics row means. Those three
 * answers live here, and here only, so a table the app does not handle cannot
 * quietly become "handled" in one place and not another.
 *
 * The canonical list matters as much as the statistics do: a table that has
 * never been received has no statistics row at all, and if the panel only ever
 * rendered rows that exist, the missing table would stay invisible — which is
 * exactly the problem this exists to fix.
 */

export type IngestCellState =
  | 'ok'
  | 'partial'
  | 'dropped'
  | 'unhandled'
  | 'never'
  /** Stored data we can see, with no receipt counters (migration not applied). */
  | 'derived';

export interface AdmsTableSpec {
  /** Upper-case ADMS `table=` value. */
  table: string;
  /**
   * True when the application acts on this table. False means the terminal may
   * send it and we currently discard it — which the panel must say out loud.
   */
  handled: boolean;
}

/**
 * Tables a ZKTeco push terminal sends, and whether we ingest each today.
 *
 * `handled: false` entries are not a to-do list, they are a statement of fact:
 * OPERLOG carries every verification attempt (including denied ones) and
 * ATTPHOTO the photo taken at a punch. We receive both, discard both, and —
 * because the ingest route always answers "OK" — the terminal never resends
 * them. Recording that here is what makes it visible rather than silent.
 */
export const ADMS_TABLES: AdmsTableSpec[] = [
  { table: 'ATTLOG', handled: true },
  { table: 'USERINFO', handled: true },
  { table: 'FINGERPRINT', handled: true },
  { table: 'BIODATA', handled: true },
  { table: 'OPERLOG', handled: false },
  { table: 'ATTPHOTO', handled: false },
];

export const ADMS_TABLE_IDS: string[] = ADMS_TABLES.map((spec) => spec.table);

const HANDLED = new Map(ADMS_TABLES.map((spec) => [spec.table, spec.handled]));

/** Normalise the `table=` query value; anything missing becomes `UNKNOWN`. */
export function normalizeTableName(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toUpperCase();
  return raw || 'UNKNOWN';
}

/** Does the app ingest this table? Unknown tables are, by definition, not. */
export function isHandledTable(table: string | null | undefined): boolean {
  return HANDLED.get(normalizeTableName(table)) === true;
}

/** One row of `device_ingest_stats` (camel-cased for the client). */
export interface IngestStatRow {
  table_name: string;
  handled: boolean;
  last_received_at: string | null;
  received_payloads: number;
  received_records: number;
  stored_records: number;
  dropped_records: number;
  /** True when the row was derived from stored data, not recorded at ingest. */
  derived?: boolean;
}

/**
 * What a cell in the panel should say.
 *
 * Order matters. An unhandled table always has `stored_records = 0`, so
 * `unhandled` has to be decided before `dropped`, or the one state we most need
 * to surface would be reported as a parsing failure instead.
 *
 * `derived` is decided first because such a row is inferred from stored data
 * rather than counted at ingest, so its `received_payloads` is meaningless and
 * must not be read as "never received".
 */
export function classifyIngestCell(row: IngestStatRow | null | undefined): IngestCellState {
  if (!row) return 'never';
  if (row.derived) return 'derived';
  if ((row.received_payloads ?? 0) <= 0) return 'never';
  if (row.handled === false) return 'unhandled';
  if ((row.stored_records ?? 0) <= 0) return 'dropped';
  if ((row.dropped_records ?? 0) > 0) return 'partial';
  return 'ok';
}

export interface IngestCellCounts {
  ok: number;
  partial: number;
  dropped: number;
  unhandled: number;
  never: number;
  derived: number;
}

/** Device-level roll-up: how many tables are actually being stored. */
export function summariseIngestCells(states: IngestCellState[]): IngestCellCounts {
  const counts: IngestCellCounts = {
    ok: 0,
    partial: 0,
    dropped: 0,
    unhandled: 0,
    never: 0,
    derived: 0,
  };
  for (const state of states) counts[state] += 1;
  return counts;
}

/**
 * Compact, locale-free age: `12s`, `5m`, `3h`, `2d`, or `—` when unknown.
 * The panel shows this next to a `title` with the exact timestamp, so there is
 * nothing to translate and nothing to get wrong across RTL.
 */
export function formatAge(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';

  const seconds = Math.max(0, Math.floor((nowMs - at) / 1000));
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}
