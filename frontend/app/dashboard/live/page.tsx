'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Fingerprint,
  KeyRound,
  Layers,
  LogIn,
  LogOut,
  MonitorSmartphone,
  PenLine,
  RefreshCw,
  ScanFace,
  Search,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/components/LanguageContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SortHeader } from '@/components/SortHeader';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { MetricTile } from '@/components/ui/StatCard';
import {
  Table,
  TableCard,
  TableMessageRow,
  TableScroll,
  TBody,
  Td,
  THead,
  Tr,
} from '@/components/ui/Table';
import { formatPunchTime } from '@/lib/utils/formatTime';
import type { AttendanceLog } from '@/types';
import type { CSSProperties } from 'react';

const POLL_INTERVAL_MS = 4000;
const ROW_LIMIT = 50;

type FeedFilter = 'all' | 'checkin' | 'checkout' | 'manual';

type EmployeeLite = {
  full_name: string;
  branch?: string | null;
  department?: string | null;
};

function isCheckInStatus(status: AttendanceLog['status']) {
  return status === '0' || status === 0;
}

function isCheckOutStatus(status: AttendanceLog['status']) {
  return status === '1' || status === 1;
}

function isManual(log: AttendanceLog) {
  return Boolean(log.is_manual) || !log.sn;
}

function employeeName(log: AttendanceLog) {
  return log.employees?.full_name || `Employee ${log.pin}`;
}

function compareLogs(a: AttendanceLog, b: AttendanceLog, key: string): number {
  switch (key) {
    case 'employee':
      return (a.employees?.full_name || `Employee ${a.pin}`).localeCompare(
        b.employees?.full_name || `Employee ${b.pin}`,
      );
    case 'pin':
      return (Number(a.pin) || 0) - (Number(b.pin) || 0);
    case 'timestamp':
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    case 'status':
      return String(a.status ?? '0').localeCompare(String(b.status ?? '0'));
    case 'verify_mode':
      return String(a.verify_mode ?? '0').localeCompare(String(b.verify_mode ?? '0'));
    case 'source':
      return (isManual(a) ? 'Manual' : a.sn || '').localeCompare(
        isManual(b) ? 'Manual' : b.sn || '',
      );
    default:
      return 0;
  }
}

export default function LiveMonitor() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<FeedFilter>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [sortKey, setSortKey] = useState<string>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const empMapRef = useRef<Map<string, EmployeeLite>>(new Map());
  const supabase = useMemo(() => createClient(), []);
  const { t } = useLanguage();

  // Employee names are cached once and reused, so an incoming realtime row does
  // not trigger an extra round-trip per punch.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('employees')
        .select('pin, full_name, branch, department');
      if (!data) return;
      const map = new Map<string, EmployeeLite>();
      data.forEach((emp) => map.set(emp.pin, emp));
      empMapRef.current = map;
    })();
  }, [supabase]);

  // "x seconds ago" ticker for the freshness indicator.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!lastUpdated) return;
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  const fetchLogs = useCallback(
    async (isManualTrigger = false) => {
      if (isManualTrigger) setIsRefreshing(true);
      try {
        const { data, error } = await supabase
          .from('attendance_logs')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(ROW_LIMIT);

        if (error) {
          console.error('[Live Monitor] Error fetching logs:', error.message);
          return;
        }

        setLogs(
          (data || []).map((log) => ({
            ...log,
            employees: empMapRef.current.get(log.pin) || null,
          })) as AttendanceLog[],
        );
        setLastUpdated(new Date());
      } catch (err: unknown) {
        console.error('[Live Monitor] Catch error:', err);
      } finally {
        setIsInitialLoad(false);
        if (isManualTrigger) {
          setTimeout(() => setIsRefreshing(false), 300);
        }
      }
    },
    [supabase],
  );

  useEffect(() => {
    void fetchLogs();

    const pollInterval = setInterval(() => void fetchLogs(), POLL_INTERVAL_MS);

    const channel = supabase
      .channel('realtime_live_logs_stream')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
        (payload) => {
          const newLog = payload.new as AttendanceLog;
          setLogs((prev) => {
            const exists = prev.some(
              (log) =>
                log.id === newLog.id ||
                (log.pin === newLog.pin && log.timestamp === newLog.timestamp),
            );
            if (exists) return prev;
            return [
              {
                ...newLog,
                employees: empMapRef.current.get(newLog.pin) || null,
              },
              ...prev,
            ].slice(0, ROW_LIMIT);
          });
          setLastUpdated(new Date());
        },
      )
      .subscribe();

    return () => {
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
    };
  }, [fetchLogs, supabase]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const searchFilteredLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return logs;

    return logs.filter((log) => {
      const name = log.employees?.full_name?.toLowerCase() || '';
      const pin = String(log.pin).toLowerCase();
      const sn = (log.sn || '').toLowerCase();
      return name.includes(term) || pin.includes(term) || sn.includes(term);
    });
  }, [logs, searchTerm]);

  // The insight tiles summarise everything matching the search, while the table
  // additionally honours the punch-type filter.
  const metrics = useMemo(() => {
    let checkins = 0;
    let checkouts = 0;
    let manual = 0;
    const people = new Set<string>();

    searchFilteredLogs.forEach((log) => {
      if (isCheckInStatus(log.status)) checkins += 1;
      else if (isCheckOutStatus(log.status)) checkouts += 1;
      if (isManual(log)) manual += 1;
      people.add(log.pin);
    });

    return {
      total: searchFilteredLogs.length,
      checkins,
      checkouts,
      manual,
      people: people.size,
    };
  }, [searchFilteredLogs]);

  const feedLogs = useMemo(() => {
    const scoped =
      typeFilter === 'all'
        ? searchFilteredLogs
        : searchFilteredLogs.filter((log) => {
            if (typeFilter === 'manual') return isManual(log);
            if (typeFilter === 'checkin') return isCheckInStatus(log.status);
            return isCheckOutStatus(log.status);
          });

    return [...scoped].sort((a, b) =>
      sortOrder === 'asc'
        ? compareLogs(a, b, sortKey)
        : -compareLogs(a, b, sortKey),
    );
  }, [searchFilteredLogs, typeFilter, sortKey, sortOrder]);

  const freshness = lastUpdated
    ? secondsAgo < 2
      ? t('live_badge')
      : `${secondsAgo}s`
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('live_title')}
        description={t('live_subtitle')}
        badge={
          <Badge tone="success" dot pulse>
            {t('live_streaming')}
          </Badge>
        }
        actions={
          <>
            <div className="relative flex-1 sm:w-64 sm:flex-none">
              <Search
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <Input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={t('live_search_placeholder')}
                aria-label={t('live_search_placeholder')}
                className="h-10 ps-9"
              />
            </div>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => void fetchLogs(true)}
              loading={isRefreshing}
              aria-label={t('refresh')}
              title={t('refresh')}
            >
              <RefreshCw size={16} />
            </Button>
          </>
        }
      />

      <Card className="flex flex-wrap items-center justify-between gap-3 p-3.5">
        <SegmentedControl<FeedFilter>
          ariaLabel={t('live_filter_label')}
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: 'all', label: t('all'), icon: Layers },
            { value: 'checkin', label: t('status_checkin'), icon: LogIn },
            { value: 'checkout', label: t('status_checkout'), icon: LogOut },
            { value: 'manual', label: t('source_manual'), icon: PenLine },
          ]}
        />

        <div className="flex items-center gap-2.5">
          {metrics.manual > 0 && (
            <Badge tone="accent" size="sm" icon={PenLine}>
              {metrics.manual} {t('live_metric_manual')}
            </Badge>
          )}

          {freshness && (
            <span
              className="flex items-center gap-2 text-xs font-medium text-ink-muted"
              data-numeric
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {t('live_updated_label')} {freshness}
            </span>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t('live_metric_punches')}
          value={metrics.total}
          icon={Activity}
          tone="aurora"
        />
        <MetricTile
          label={t('live_metric_checkins')}
          value={metrics.checkins}
          icon={LogIn}
          tone="success"
        />
        <MetricTile
          label={t('live_metric_checkouts')}
          value={metrics.checkouts}
          icon={LogOut}
          tone="brand"
        />
        <MetricTile
          label={t('live_metric_people')}
          value={metrics.people}
          icon={Users}
          tone="info"
        />
      </div>

      <TableCard>
        <TableScroll>
          <Table caption={t('live_title')} className="min-w-[56rem]">
            <THead>
              <tr>
                <SortHeader
                  columnKey="employee"
                  label={t('col_employee')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="pin"
                  label={t('col_pin')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="timestamp"
                  label={t('col_timestamp')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="status"
                  label={t('col_status')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="verify_mode"
                  label={t('col_verify_mode')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
                <SortHeader
                  columnKey="source"
                  label={t('col_source_device')}
                  activeKey={sortKey}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </tr>
            </THead>

            <TBody>
              {isInitialLoad && (
                <TableMessageRow colSpan={6}>
                  <TableSkeleton rows={6} columns={6} className="text-start" />
                </TableMessageRow>
              )}

              {!isInitialLoad &&
                feedLogs.map((log, index) => {
                  const isCheckIn = isCheckInStatus(log.status);
                  const isCheckOut = isCheckOutStatus(log.status);
                  const name = employeeName(log);

                  return (
                    <Tr
                      key={log.id || `${log.pin}-${log.timestamp}-${index}`}
                      className="stagger-in"
                      style={{ '--ui-i': Math.min(index, 10) } as CSSProperties}
                    >
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{name}</p>
                            {log.employees?.department && (
                              <p className="mt-0.5 truncate text-xs text-ink-subtle">
                                {log.employees.department}
                                {log.employees.branch
                                  ? ` • ${log.employees.branch}`
                                  : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </Td>

                      <Td numeric className="font-mono font-medium text-ink-muted">
                        {log.pin}
                      </Td>

                      <Td>
                        <p className="font-mono font-semibold text-ink" data-numeric>
                          {formatPunchTime(log.timestamp)}
                        </p>
                        <p
                          className="mt-0.5 font-mono text-xs text-ink-subtle"
                          data-numeric
                        >
                          {log.timestamp
                            ? new Date(log.timestamp).toISOString().substring(0, 10)
                            : '-'}
                        </p>
                      </Td>

                      <Td>
                        <Badge
                          tone={isCheckIn ? 'success' : isCheckOut ? 'brand' : 'neutral'}
                          dot
                        >
                          {isCheckIn
                            ? t('status_checkin')
                            : isCheckOut
                              ? t('status_checkout')
                              : `${t('status_other')} ${log.status}`}
                        </Badge>
                      </Td>

                      <Td>
                        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                          {log.verify_mode === '1' || log.verify_mode === 1 ? (
                            <>
                              <Fingerprint
                                size={14}
                                className="text-brand"
                                aria-hidden="true"
                              />
                              {t('mode_fingerprint')}
                            </>
                          ) : log.verify_mode === '15' || log.verify_mode === 15 ? (
                            <>
                              <ScanFace
                                size={14}
                                className="text-violet-500"
                                aria-hidden="true"
                              />
                              {t('mode_face')}
                            </>
                          ) : (
                            <>
                              <KeyRound
                                size={14}
                                className="text-amber-500"
                                aria-hidden="true"
                              />
                              {t('mode_card_pass')}
                            </>
                          )}
                        </span>
                      </Td>

                      <Td>
                        {isManual(log) ? (
                          <Badge tone="accent" size="sm" icon={PenLine}>
                            {t('source_manual')}
                          </Badge>
                        ) : (
                          <span className="flex items-center gap-1.5 font-mono text-xs text-ink-muted">
                            <MonitorSmartphone
                              size={13}
                              className="text-ink-subtle"
                              aria-hidden="true"
                            />
                            {log.sn}
                          </span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}

              {!isInitialLoad && feedLogs.length === 0 && (
                <TableMessageRow colSpan={6}>
                  <EmptyState
                    icon={Activity}
                    title={t('live_no_punches')}
                    description={t('live_search_placeholder')}
                  />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableCard>
    </div>
  );
}
