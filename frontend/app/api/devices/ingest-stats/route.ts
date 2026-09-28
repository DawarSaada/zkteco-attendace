import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import {
    ADMS_TABLE_IDS,
    classifyIngestCell,
    isHandledTable,
    summariseIngestCells,
    type IngestStatRow,
} from '@/lib/adms/tables';

/**
 * What each terminal has actually sent, per ADMS table.
 *
 * Two things this endpoint refuses to do:
 *
 *  1. It never returns only the tables that have statistics. The column list is
 *     the canonical table list first, so a table the terminal has never sent —
 *     or one the app does not ingest — still gets a cell saying so. A table that
 *     is missing from the response would be invisible, which is the exact
 *     failure this whole screen exists to prevent.
 *  2. It never reports an inferred number as if it had been counted at ingest.
 *     Any table without a receipt counter is derived from the rows already
 *     stored and marked `derived`, which the panel shows as such.
 */

interface DeviceRow {
    sn: string;
    name: string | null;
    branch: string | null;
    last_active: string | null;
}

interface RecordedStat extends IngestStatRow {
    sn: string;
}

/**
 * Where each ingestible table's rows end up. Used only for the derived
 * fallback: it can show that data is being stored, but it cannot show that a
 * table was received and discarded, because a discarded table stores nothing.
 */
const DERIVED_SOURCES: { table: string; from: string; column: string }[] = [
    { table: 'ATTLOG', from: 'attendance_logs', column: 'created_at' },
    { table: 'USERINFO', from: 'device_users', column: 'updated_at' },
    { table: 'FINGERPRINT', from: 'biometric_templates', column: 'captured_at' },
];

async function deriveRow(
    supabase: SupabaseClient,
    source: { table: string; from: string; column: string },
    sn: string,
): Promise<IngestStatRow | null> {
    const { data, count, error } = await supabase
        .from(source.from)
        .select(source.column, { count: 'exact' })
        .eq('sn', sn)
        .order(source.column, { ascending: false })
        .limit(1);

    // The table itself may not exist yet (its own migration is pending).
    if (error) return null;

    const total = count ?? 0;
    // The select list is a runtime string, so PostgREST's row type is opaque here.
    const first = ((data ?? []) as unknown[])[0] as Record<string, string | null> | undefined;

    return {
        table_name: source.table,
        handled: isHandledTable(source.table),
        derived: true,
        last_received_at: first?.[source.column] ?? null,
        received_payloads: 0,
        received_records: total,
        stored_records: total,
        dropped_records: 0,
    };
}

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const sn = new URL(request.url).searchParams.get('sn');

        const [devicesRes, statsRes] = await Promise.all([
            supabase
                .from('devices')
                .select('sn, name, branch, last_active')
                .order('name', { ascending: true }),
            supabase.from('device_ingest_stats').select('*'),
        ]);

        if (devicesRes.error) {
            return NextResponse.json({ error: devicesRes.error.message }, { status: 500 });
        }

        // `?sn=` narrows the panel to one terminal; unknown SNs yield no rows
        // rather than an error, so the caller cannot probe for devices.
        const devices = ((devicesRes.data ?? []) as DeviceRow[]).filter(
            (device) => !sn || device.sn === sn,
        );
        const migrationApplied = !statsRes.error;
        const recorded = (migrationApplied ? (statsRes.data ?? []) : []) as RecordedStat[];

        // Canonical tables first, then anything else the terminals actually sent.
        const extras = Array.from(new Set(recorded.map((row) => row.table_name)))
            .filter((table) => !ADMS_TABLE_IDS.includes(table))
            .sort();
        const tables = [...ADMS_TABLE_IDS, ...extras];

        const rows = await Promise.all(
            devices.map(async (device) => {
                const byTable = new Map<string, IngestStatRow>();
                for (const row of recorded) {
                    if (row.sn === device.sn) byTable.set(row.table_name, row);
                }

                // Derived for any table with no receipt counter. Before the
                // migration that is every table; after it the counters start empty,
                // so a terminal with 14,000 stored punches would otherwise read as
                // "never received" until its next push. Counters always win.
                const counted = new Set(byTable.keys());
                const derived = await Promise.all(
                    DERIVED_SOURCES.filter((source) => !counted.has(source.table)).map(
                        (source) => deriveRow(supabase, source, device.sn),
                    ),
                );
                for (const row of derived) {
                    if (row) byTable.set(row.table_name, row);
                }

                const cells = tables.map((table) => {
                    const row = byTable.get(table) ?? null;
                    return {
                        table,
                        state: classifyIngestCell(row),
                        handled: row?.handled ?? isHandledTable(table),
                        derived: row?.derived ?? false,
                        last_received_at: row?.last_received_at ?? null,
                        received_payloads: row?.received_payloads ?? 0,
                        received_records: row?.received_records ?? 0,
                        stored_records: row?.stored_records ?? 0,
                        dropped_records: row?.dropped_records ?? 0,
                    };
                });

                return {
                    sn: device.sn,
                    name: device.name,
                    branch: device.branch,
                    last_active: device.last_active,
                    cells,
                    counts: summariseIngestCells(cells.map((cell) => cell.state)),
                };
            }),
        );

        return NextResponse.json({
            generatedAt: new Date().toISOString(),
            migrationApplied,
            tables,
            devices: rows,
        });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
