'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Info,
  MonitorSmartphone,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import {
  Table,
  TableMessageRow,
  TableScroll,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { formatAge, type IngestCellState } from '@/lib/adms/tables';
import type { TranslationKey } from '@/lib/i18n/translations';

/**
 * What each terminal has actually sent, by ADMS table.
 *
 * The point of this panel is the row that is missing or the row that says "not
 * ingested". Before it existed, a table the terminal pushes and the app discards
 * (OPERLOG, ATTPHOTO) was indistinguishable from a table that was never sent —
 * both left no trace. So every canonical table gets a row on every terminal,
 * including the ones with nothing to report, and the ways data can be lost each
 * get their own wording rather than a generic "no data".
 *
 * `sn` narrows the panel to one terminal; without it, all of them are listed.
 */

interface IngestCell {
  table: string;
  state: IngestCellState;
  handled: boolean;
  derived: boolean;
  last_received_at: string | null;
  received_payloads: number;
  received_records: number;
  stored_records: number;
  dropped_records: number;
}

interface DeviceIngest {
  sn: string;
  name: string | null;
  branch: string | null;
  last_active: string | null;
  cells: IngestCell[];
  counts: Record<IngestCellState, number>;
}

interface IngestPayload {
  generatedAt: string;
  migrationApplied: boolean;
  tables: string[];
  devices: DeviceIngest[];
}

interface StatsResult {
  ok: boolean;
  data: IngestPayload & { error?: string };
}

/** Module-level so the effect can await it with no setState in between. */
async function fetchStats(sn?: string): Promise<StatsResult> {
  const res = await fetch(`/api/devices/ingest-stats${sn ? `?sn=${encodeURIComponent(sn)}` : ''}`);
  const data = (await res.json()) as IngestPayload & { error?: string };
  return { ok: res.ok, data };
}

const STATE_TONE: Record<IngestCellState, BadgeTone> = {
  ok: 'success',
  partial: 'warning',
  dropped: 'danger',
  unhandled: 'danger',
  never: 'neutral',
  derived: 'info',
};

const STATE_KEY: Record<IngestCellState, TranslationKey> = {
  ok: 'ingest_state_ok',
  partial: 'ingest_state_partial',
  dropped: 'ingest_state_dropped',
  unhandled: 'ingest_state_unhandled',
  never: 'ingest_state_never',
  derived: 'ingest_state_derived',
};

const TABLE_LABEL: Record<string, TranslationKey> = {
  ATTLOG: 'ingest_table_attlog',
  USERINFO: 'ingest_table_userinfo',
  FINGERPRINT: 'ingest_table_fingerprint',
  BIODATA: 'ingest_table_biodata',
  OPERLOG: 'ingest_table_operlog',
  ATTPHOTO: 'ingest_table_attphoto',
};

function count(value: number): string {
  return value > 0 ? value.toLocaleString('en-US') : '—';
}

function exact(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString().slice(0, 19).replace('T', ' ');
}

export function DeviceDataPanel({ sn }: { sn?: string }) {
  const [payload, setPayload] = useState<IngestPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { t } = useLanguage();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const result = await fetchStats(sn);
      if (result.ok) setPayload(result.data);
      else toast.error(result.data.error || t('ingest_load_failed'));
    } catch {
      toast.error(t('ingest_load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [sn, t, toast]);

  useEffect(() => {
    let cancelled = false;
    fetchStats(sn)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setPayload(result.data);
        else toast.error(result.data.error || t('ingest_load_failed'));
      })
      .catch(() => {
        if (!cancelled) toast.error(t('ingest_load_failed'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sn, t, toast]);

  // Ages are measured against the moment the statistics were read, not the
  // browser clock: one consistent reference for every row, no clock read during
  // render, and refreshing the panel is what moves the ages on.
  const nowMs = payload ? Date.parse(payload.generatedAt) : 0;
  const devices = payload?.devices ?? [];

  return (
    <Card>
      <CardHeader
        title={t('ingest_title')}
        description={t('ingest_desc')}
        icon={Database}
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsLoading(true);
              void load();
            }}
            aria-label={t('refresh')}
            title={t('refresh')}
          >
            <RefreshCw size={16} />
          </Button>
        }
      />

      {payload && payload.migrationApplied === false && (
        <p className="mx-5 mt-4 flex items-start gap-2.5 rounded-xl border border-info-line bg-info-soft px-3.5 py-2.5 text-[11px] leading-relaxed font-medium text-info">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('ingest_derived_hint')}
        </p>
      )}

      <TableScroll>
        <Table caption={t('ingest_title')} className="min-w-[46rem]">
          <THead>
            <tr>
              <Th>{t('ingest_col_table')}</Th>
              <Th>{t('ingest_col_state')}</Th>
              <Th>{t('ingest_col_last')}</Th>
              <Th align="end">{t('ingest_col_received')}</Th>
              <Th align="end">{t('ingest_col_stored')}</Th>
              <Th align="end">{t('ingest_col_dropped')}</Th>
            </tr>
          </THead>

          <TBody>
            {isLoading && (
              <TableMessageRow colSpan={6}>
                <TableSkeleton rows={4} columns={6} />
              </TableMessageRow>
            )}

            {!isLoading && devices.length === 0 && (
              <TableMessageRow colSpan={6}>
                <EmptyState
                  icon={MonitorSmartphone}
                  title={t('ingest_no_devices')}
                  description={t('ingest_no_devices_desc')}
                />
              </TableMessageRow>
            )}

            {!isLoading &&
              devices.flatMap((device) => [
                <Tr key={`${device.sn}-header`} className="bg-surface-2/60">
                  <Td colSpan={6} className="py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-xs font-bold text-ink">
                        {device.name || t('dev_unnamed')}
                      </span>
                      <span className="font-mono text-[11px] text-ink-subtle">{device.sn}</span>
                      {device.branch && (
                        <Badge tone="neutral" size="sm">
                          {device.branch}
                        </Badge>
                      )}
                      {device.counts.unhandled > 0 ? (
                        <Badge tone="danger" size="sm" icon={AlertTriangle}>
                          {device.counts.unhandled} {t('ingest_unhandled_short')}
                        </Badge>
                      ) : (
                        <Badge tone="success" size="sm" icon={CheckCircle2}>
                          {device.counts.ok + device.counts.derived}/{device.cells.length}{' '}
                          {t('ingest_stored_short')}
                        </Badge>
                      )}
                    </div>
                  </Td>
                </Tr>,
                ...device.cells.map((cell) => (
                  <Tr key={`${device.sn}-${cell.table}`}>
                    <Td>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-ink">
                          {TABLE_LABEL[cell.table]
                            ? t(TABLE_LABEL[cell.table])
                            : cell.table}
                        </span>
                        <span className="font-mono text-[10px] text-ink-subtle">
                          {cell.table}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={STATE_TONE[cell.state]} size="sm" dot={cell.state !== 'never'}>
                        {t(STATE_KEY[cell.state])}
                      </Badge>
                      {cell.state === 'unhandled' && (
                        <p className="mt-1 text-[10px] leading-relaxed text-danger">
                          {t('ingest_unhandled_hint')}
                        </p>
                      )}
                      {cell.derived && (
                        <p className="mt-1 text-[10px] leading-relaxed text-ink-subtle">
                          {t('ingest_derived_tag')}
                        </p>
                      )}
                    </Td>
                    <Td className="font-mono text-xs text-ink-muted" data-numeric>
                      <span title={exact(cell.last_received_at)}>
                        {formatAge(cell.last_received_at, nowMs)}
                      </span>
                    </Td>
                    <Td align="end" className="font-mono text-xs text-ink-muted" data-numeric>
                      {count(cell.received_records)}
                    </Td>
                    <Td
                      align="end"
                      className="font-mono text-xs font-semibold text-ink"
                      data-numeric
                    >
                      {count(cell.stored_records)}
                    </Td>
                    <Td
                      align="end"
                      className={
                        cell.dropped_records > 0
                          ? 'font-mono text-xs font-semibold text-danger'
                          : 'font-mono text-xs text-ink-subtle'
                      }
                      data-numeric
                    >
                      {count(cell.dropped_records)}
                    </Td>
                  </Tr>
                )),
              ])}
          </TBody>
        </Table>
      </TableScroll>
    </Card>
  );
}
