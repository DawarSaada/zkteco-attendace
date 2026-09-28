'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
  Gauge,
  HeartPulse,
  MonitorSmartphone,
  RefreshCw,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/components/LanguageContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { BarChart, ChartLegend, Donut } from '@/components/ui/Charts';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton, StatCardSkeleton } from '@/components/ui/Skeleton';
import { MetricTile, StatCard, TONE_TILE } from '@/components/ui/StatCard';
import { cn } from '@/lib/utils/cn';
import { formatPunchTime } from '@/lib/utils/formatTime';
import type { AttendanceLog, Device, Employee } from '@/types';
import type { IconComponent } from '@/components/ui/icon';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const RECENT_LIMIT = 6;
const TREND_DAYS = 14;

interface TrendPoint {
  label: string;
  value: number;
  hint: string;
}

interface Stats {
  devices: number;
  onlineDevices: number;
  employees: number;
  todayPunches: number;
  presentToday: number;
  lastHeartbeat: string | null;
  lastHeartbeatDevice: string | null;
}

const EMPTY_STATS: Stats = {
  devices: 0,
  onlineDevices: 0,
  employees: 0,
  todayPunches: 0,
  presentToday: 0,
  lastHeartbeat: null,
  lastHeartbeatDevice: null,
};

interface DailyRow {
  punch_date: string;
  total_punches: number;
}

export default function DashboardOverview() {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [trendSpark, setTrendSpark] = useState<number[]>([]);
  const [recent, setRecent] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const { t } = useLanguage();

  const supabase = useMemo(() => createClient(), []);

  // Note: this loader never flips `loading` on itself — the initial state is
  // already `true` and callers that re-run it set the flag from their event
  // handler, which avoids a redundant render on mount.
  const loadDashboard = useCallback(async () => {
    // `punch_date` is derived from the stored UTC timestamp, so the window has
    // to be computed in UTC too.
    const now = new Date();
    const today = now.toISOString().substring(0, 10);
    const windowStart = new Date(now.getTime() - (TREND_DAYS - 1) * 86_400_000)
      .toISOString()
      .substring(0, 10);

    try {
      const [devicesRes, employeesRes, reportRes, logsRes] = await Promise.all([
        fetch('/api/devices'),
        fetch('/api/employees'),
        fetch(`/api/reports/daily?start=${windowStart}&end=${today}`),
        supabase
          .from('attendance_logs')
          .select('*')
          .order('timestamp', { ascending: false })
          .limit(RECENT_LIMIT),
      ]);

      const devices: Device[] = devicesRes.ok ? await devicesRes.json() : [];
      const employees: Employee[] = employeesRes.ok ? await employeesRes.json() : [];
      const reportRows: DailyRow[] = reportRes.ok ? await reportRes.json() : [];

      const deviceList = Array.isArray(devices) ? devices : [];
      const employeeList = Array.isArray(employees) ? employees : [];
      const rows = Array.isArray(reportRows) ? reportRows : [];

      const nowMs = Date.now();
      const online = deviceList.filter(
        (device) =>
          device.last_active &&
          nowMs - new Date(device.last_active).getTime() < ONLINE_WINDOW_MS,
      );

      const heartbeats = deviceList
        .filter((device) => device.last_active)
        .sort(
          (a, b) =>
            new Date(b.last_active).getTime() - new Date(a.last_active).getTime(),
        );

      // One request now feeds both today's figures and the 14-day trend.
      const byDate = new Map<string, { punches: number; employees: number }>();
      rows.forEach((row) => {
        const current = byDate.get(row.punch_date) || { punches: 0, employees: 0 };
        current.punches += row.total_punches || 0;
        current.employees += 1;
        byDate.set(row.punch_date, current);
      });

      const series: TrendPoint[] = [];
      for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
        const date = new Date(nowMs - offset * 86_400_000)
          .toISOString()
          .substring(0, 10);
        const bucket = byDate.get(date);
        series.push({
          label: date.substring(8, 10),
          value: bucket?.punches ?? 0,
          hint: `${bucket?.employees ?? 0} ${t('stat_employees_present')}`,
        });
      }

      const todayBucket = byDate.get(today) || { punches: 0, employees: 0 };

      setTrend(series);
      setTrendSpark(series.map((point) => point.value));

      setStats({
        devices: deviceList.length,
        onlineDevices: online.length,
        employees: employeeList.length,
        todayPunches: todayBucket.punches,
        presentToday: todayBucket.employees,
        lastHeartbeat: heartbeats[0]?.last_active ?? null,
        lastHeartbeatDevice: heartbeats[0]?.name || heartbeats[0]?.sn || null,
      });

      const nameByPin = new Map(employeeList.map((employee) => [employee.pin, employee]));
      const logs = logsRes.error ? [] : ((logsRes.data || []) as AttendanceLog[]);
      setRecent(
        logs.map((log) => ({ ...log, employees: nameByPin.get(log.pin) || null })),
      );

      setFailed(!devicesRes.ok || !employeesRes.ok || !reportRes.ok);
    } catch (error) {
      console.error('[dashboard] failed to load overview data:', error);
      setFailed(true);
    } finally {
      // Always clear the loading state, otherwise a rejected request would
      // leave the page on its skeletons permanently.
      setLoading(false);
    }
  }, [supabase, t]);

  useEffect(() => {
    // Deferred off the effect path: the loader sets state, and calling it
    // synchronously here is what react-hooks/set-state-in-effect flags.
    void Promise.resolve().then(loadDashboard);
  }, [loadDashboard]);

  const heartbeatLabel = stats.lastHeartbeat
    ? new Date(stats.lastHeartbeat).toLocaleString()
    : null;

  const attendanceRate =
    stats.employees > 0
      ? Math.round((stats.presentToday / stats.employees) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav_overview')}
        title={t('overview_title')}
        description={t('overview_subtitle')}
        actions={
          <>
            <Button
              variant="primary"
              icon={Activity}
              href="/dashboard/live"
              className="flex-1 sm:flex-none"
            >
              {t('nav_live')}
            </Button>
            <Button
              variant="secondary"
              icon={FileSpreadsheet}
              href="/dashboard/reports"
              className="flex-1 sm:flex-none"
            >
              {t('nav_reports')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setLoading(true);
                void loadDashboard();
              }}
              aria-label={t('refresh')}
              title={t('refresh')}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </Button>
          </>
        }
      />

      {failed && (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-xs leading-relaxed font-medium text-warning"
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('overview_data_error')}</span>
        </p>
      )}

      {loading ? (
        <StatCardSkeleton count={4} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t('stat_terminals')}
            value={stats.devices}
            icon={MonitorSmartphone}
            tone="aurora"
            footer={
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone="success" size="sm" dot pulse={stats.onlineDevices > 0}>
                  {stats.onlineDevices} {t('dev_online_count')}
                </Badge>
                <Badge tone="neutral" size="sm">
                  {stats.devices - stats.onlineDevices} {t('dev_offline_count')}
                </Badge>
              </span>
            }
          />

          <StatCard
            label={t('stat_employees')}
            value={stats.employees}
            icon={Users}
            tone="info"
            footer={
              <span className="text-[11px] font-medium text-ink-muted">
                {t('stat_registered_profiles')}
              </span>
            }
          />

          <StatCard
            label={t('stat_today_punches')}
            value={stats.todayPunches}
            icon={Activity}
            tone="success"
            sparkline={trendSpark}
            footer={
              <span className="text-[11px] font-medium text-ink-muted">
                <span className="font-bold text-ink">{stats.presentToday}</span>{' '}
                {t('stat_employees_present')}
              </span>
            }
          />

          <StatCard
            label={t('stat_heartbeat_from')}
            valueNode={
              heartbeatLabel ? (
                <span className="text-[0.95rem] leading-tight font-bold tracking-tight text-ink">
                  {heartbeatLabel}
                </span>
              ) : (
                <span className="text-sm font-semibold text-ink-subtle">
                  {t('stat_no_heartbeat')}
                </span>
              )
            }
            icon={HeartPulse}
            tone="warning"
            footer={
              <span className="truncate text-[11px] font-medium text-ink-muted">
                {stats.lastHeartbeatDevice
                  ? `${t('stat_heartbeat_device')}: ${stats.lastHeartbeatDevice}`
                  : t('stat_adms_info')}
              </span>
            }
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={t('attendance_trend_title')}
            description={t('attendance_trend_desc')}
            icon={Activity}
            actions={
              <Badge tone="brand" size="sm">
                {TREND_DAYS} {t('filter_timeframe')}
              </Badge>
            }
          />
          <div className="p-5">
            {loading ? (
              <Skeleton className="h-[13.5rem] w-full" />
            ) : trend.every((point) => point.value === 0) ? (
              <EmptyState icon={Activity} title={t('trend_no_data')} className="py-8" />
            ) : (
              <BarChart
                data={trend}
                height={168}
                suffix={` ${t('punches_label')}`}
              />
            )}

            {!loading && trend.length > 0 && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <MetricTile
                  label={t('attendance_rate')}
                  value={attendanceRate}
                  suffix="%"
                  icon={Gauge}
                  tone="success"
                />
                <MetricTile
                  label={t('stat_today_punches')}
                  value={stats.todayPunches}
                  icon={Activity}
                  tone="aurora"
                />
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={t('terminal_health_title')}
            description={t('terminal_health_desc')}
            icon={MonitorSmartphone}
          />
          <div className="flex flex-col items-center gap-5 p-5">
            {loading ? (
              <Skeleton className="h-[10.5rem] w-[10.5rem] rounded-full" />
            ) : stats.devices === 0 ? (
              <EmptyState
                icon={MonitorSmartphone}
                title={t('health_no_devices')}
                className="py-8"
              />
            ) : (
              <>
                <Donut
                  segments={[
                    {
                      label: t('dev_online_count'),
                      value: stats.onlineDevices,
                      tone: 'success',
                    },
                    {
                      label: t('dev_offline_count'),
                      value: stats.devices - stats.onlineDevices,
                      tone: 'danger',
                    },
                  ]}
                  centerLabel={`${Math.round((stats.onlineDevices / stats.devices) * 100)}%`}
                  centerSub={t('server_online')}
                />
                <ChartLegend
                  className="w-full"
                  segments={[
                    {
                      label: t('dev_online_count'),
                      value: stats.onlineDevices,
                      tone: 'success',
                    },
                    {
                      label: t('dev_offline_count'),
                      value: stats.devices - stats.onlineDevices,
                      tone: 'danger',
                    },
                  ]}
                />
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Latest activity */}
      <Card>
        <CardHeader
          title={t('latest_activity_title')}
          description={t('latest_activity_desc')}
          icon={Activity}
          actions={
            <Button
              variant="ghost"
              size="sm"
              href="/dashboard/live"
              trailingIcon={ArrowRight}
              className="group/btn"
            >
              {t('view_all_activity')}
            </Button>
          }
        />
        <div className="divide-y divide-line">
          {loading &&
            Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 px-5 py-3.5">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
            ))}

          {!loading && recent.length === 0 && (
            <EmptyState
              icon={Activity}
              title={t('latest_activity_empty')}
              className="py-14"
            />
          )}

          {!loading &&
            recent.map((log, index) => {
              const isCheckIn = log.status === '0' || log.status === 0;
              const isCheckOut = log.status === '1' || log.status === 1;
              const name = log.employees?.full_name || `Employee ${log.pin}`;

              return (
                <div
                  key={log.id ?? `${log.pin}-${log.timestamp}`}
                  style={{ '--ui-i': index } as React.CSSProperties}
                  className="stagger-in flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-2/60"
                >
                  <Avatar name={name} />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{name}</p>
                    <p className="truncate text-[11px] text-ink-subtle">
                      {log.employees?.department || log.sn || t('unassigned')}
                    </p>
                  </div>

                  <span
                    data-numeric
                    className="hidden shrink-0 font-mono text-xs font-semibold text-ink-muted sm:block"
                  >
                    {formatPunchTime(log.timestamp)}
                  </span>

                  <Badge
                    tone={isCheckIn ? 'success' : isCheckOut ? 'brand' : 'neutral'}
                    size="sm"
                    dot
                    className="shrink-0"
                  >
                    {isCheckIn
                      ? t('status_checkin')
                      : isCheckOut
                        ? t('status_checkout')
                        : `${t('status_other')} ${log.status}`}
                  </Badge>
                </div>
              );
            })}
        </div>
      </Card>

      {/* Quick actions */}
      <div className="grid gap-5 md:grid-cols-3">
        <QuickAction
          href="/dashboard/live"
          icon={Activity}
          tone="success"
          title={t('quick_live_title')}
          description={t('quick_live_desc')}
          linkLabel={t('nav_live')}
        />
        <QuickAction
          href="/dashboard/reports"
          icon={FileSpreadsheet}
          tone="aurora"
          title={t('quick_reports_title')}
          description={t('quick_reports_desc')}
          linkLabel={t('nav_reports')}
        />
        <QuickAction
          href="/dashboard/devices"
          icon={MonitorSmartphone}
          tone="info"
          title={t('quick_devices_title')}
          description={t('quick_devices_desc')}
          linkLabel={t('nav_devices')}
        />
      </div>
    </div>
  );
}

function QuickAction({
  href,
  icon: Icon,
  tone,
  title,
  description,
  linkLabel,
}: {
  href: string;
  icon: IconComponent;
  tone: 'aurora' | 'success' | 'info';
  title: string;
  description: string;
  linkLabel: string;
}) {
  return (
    <Link href={href} className="group block">
      <Card interactive className="h-full p-5">
        <span
          className={cn(
            'glow-current grid h-11 w-11 place-items-center rounded-xl border',
            TONE_TILE[tone],
          )}
        >
          <Icon size={20} aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-sm font-bold text-ink transition-colors group-hover:text-brand">
          {title}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{description}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
          {linkLabel}
          <ArrowRight
            size={13}
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1"
          />
        </span>
      </Card>
    </Link>
  );
}
