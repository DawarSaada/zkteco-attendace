import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMS_TABLE_IDS,
  ADMS_TABLES,
  classifyIngestCell,
  formatAge,
  isHandledTable,
  normalizeTableName,
  summariseIngestCells,
  type IngestCellState,
  type IngestStatRow,
} from './tables.ts';

function stat(overrides: Partial<IngestStatRow> = {}): IngestStatRow {
  return {
    table_name: 'ATTLOG',
    handled: true,
    last_received_at: '2026-09-27T09:00:00.000Z',
    received_payloads: 4,
    received_records: 120,
    stored_records: 120,
    dropped_records: 0,
    ...overrides,
  };
}

test('tables: the canonical list states plainly which tables are not ingested', () => {
  assert.deepEqual(ADMS_TABLE_IDS, [
    'ATTLOG',
    'USERINFO',
    'FINGERPRINT',
    'BIODATA',
    'OPERLOG',
    'ATTPHOTO',
  ]);
  const unhandled = ADMS_TABLES.filter((spec) => !spec.handled).map((spec) => spec.table);
  // These are the tables a terminal sends and the app currently discards.
  assert.deepEqual(unhandled, ['OPERLOG', 'ATTPHOTO']);
});

test('tables: names are normalised, and anything unknown is not handled', () => {
  assert.equal(normalizeTableName(' attlog '), 'ATTLOG');
  assert.equal(normalizeTableName('userinfo'), 'USERINFO');
  assert.equal(normalizeTableName(null), 'UNKNOWN');
  assert.equal(normalizeTableName('   '), 'UNKNOWN');

  assert.equal(isHandledTable('attlog'), true);
  assert.equal(isHandledTable('Fingerprint'), true);
  assert.equal(isHandledTable('OPERLOG'), false);
  assert.equal(isHandledTable('ATTPHOTO'), false);
  // An unrecognised table is treated as unhandled rather than assumed safe.
  assert.equal(isHandledTable('SOMETHING_NEW'), false);
  assert.equal(isHandledTable(null), false);
});

test('cell: a table never received is "never", not "broken"', () => {
  assert.equal(classifyIngestCell(null), 'never');
  assert.equal(classifyIngestCell(undefined), 'never');
  assert.equal(classifyIngestCell(stat({ received_payloads: 0, received_records: 0 })), 'never');
});

test('cell: an unhandled table wins over "nothing stored"', () => {
  // This is the important one: without the ordering, OPERLOG would look like a
  // parse failure instead of a table we deliberately do not ingest.
  const operlog = stat({
    table_name: 'OPERLOG',
    handled: false,
    received_records: 400,
    stored_records: 0,
    dropped_records: 400,
  });
  assert.equal(classifyIngestCell(operlog), 'unhandled');
});

test('cell: stored everything is ok, some dropped is partial, none is dropped', () => {
  assert.equal(classifyIngestCell(stat()), 'ok');
  assert.equal(classifyIngestCell(stat({ dropped_records: 3 })), 'partial');
  assert.equal(
    classifyIngestCell(stat({ received_records: 50, stored_records: 0, dropped_records: 50 })),
    'dropped',
  );
});

test('cell: a derived row reports stored data, not a missing receipt', () => {
  // Fallback rows (migration not applied) are inferred from stored data, so a
  // zero payload count must not be read as "never received".
  assert.equal(
    classifyIngestCell(stat({ derived: true, received_payloads: 0, received_records: 335 })),
    'derived',
  );
  // Even an inferred row for an unhandled table stays honest about that table.
  assert.equal(
    classifyIngestCell(stat({ derived: true, handled: false, stored_records: 0 })),
    'derived',
  );
});

test('rollup: counts each state once', () => {
  const states: IngestCellState[] = [
    'ok',
    'ok',
    'partial',
    'unhandled',
    'unhandled',
    'never',
    'derived',
  ];
  assert.deepEqual(summariseIngestCells(states), {
    ok: 2,
    partial: 1,
    dropped: 0,
    unhandled: 2,
    never: 1,
    derived: 1,
  });
  assert.deepEqual(summariseIngestCells([]), {
    ok: 0,
    partial: 0,
    dropped: 0,
    unhandled: 0,
    never: 0,
    derived: 0,
  });
});

test('age: a short, locale-free age that never goes negative', () => {
  const now = Date.parse('2026-09-27T12:00:00.000Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  assert.equal(formatAge(ago(5), now), '5s');
  assert.equal(formatAge(ago(59), now), '59s');
  assert.equal(formatAge(ago(60), now), '1m');
  assert.equal(formatAge(ago(60 * 59), now), '59m');
  assert.equal(formatAge(ago(60 * 60), now), '1h');
  assert.equal(formatAge(ago(60 * 60 * 23), now), '23h');
  assert.equal(formatAge(ago(60 * 60 * 24), now), '1d');
  assert.equal(formatAge(ago(60 * 60 * 24 * 9), now), '9d');

  // Unknown and unparseable are dashes; clock skew must not read as "-4s".
  assert.equal(formatAge(null, now), '—');
  assert.equal(formatAge('not-a-date', now), '—');
  assert.equal(formatAge(new Date(now + 4000).toISOString(), now), '0s');
});
