'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Download,
  ListChecks,
  MonitorSmartphone,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Input, Select } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { MetricTile } from '@/components/ui/StatCard';
import {
  Table,
  TableCard,
  TableMessageRow,
  TableScroll,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import type { BadgeTone } from '@/components/ui/Badge';
import type { TranslationKey } from '@/lib/i18n/translations';
import type { CSSProperties } from 'react';

interface DeviceLite {
  sn: string;
  name: string | null;
  branch: string | null;
  last_active: string | null;
}

interface DiffEmployee {
  pin: string;
  full_name: string | null;
  department: string | null;
  branch: string | null;
}

interface OrphanUser {
  pin: string;
  name: string | null;
}

interface Mismatch {
  pin: string;
  database_name: string | null;
  device_name: string | null;
}

interface CommandRow {
  id: string;
  command_str: string;
  payload?: { kind?: string } | null;
  status: string;
  device_seq: number | null;
  attempts: number | null;
  sent_at: string | null;
  acked_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface TemplateRow {
  pin: string;
  fid: number;
  size: number | null;
  captured_at: string;
}

interface SettingRow {
  key: string;
  value: string | null;
  updated_at: string;
}

interface ProvisionData {
  device: DeviceLite;
  summary: {
    employees: number;
    onDevice: number;
    missingOnDevice: number;
    orphanedOnDevice: number;
    nameMismatches: number;
    templates: number;
  };
  missingOnDevice: DiffEmployee[];
  orphanedOnDevice: OrphanUser[];
  nameMismatches: Mismatch[];
  commands: CommandRow[];
  templates: TemplateRow[];
  settings: SettingRow[];
}

type DiffTab = 'missing' | 'orphaned' | 'mismatch';

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'neutral',
  SENT: 'info',
  ACKNOWLEDGED: 'success',
  FAILED: 'danger',
};

interface PendingConfirm {
  action: string;
  pin?: string;
  title: string;
  description: string;
  confirmLabel: string;
}

export default function ProvisioningPage() {
  const [devices, setDevices] = useState<DeviceLite[]>([]);
  const [sn, setSn] = useState('');
  const [data, setData] = useState<ProvisionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<DiffTab>('missing');
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [params, setParams] = useState({ verifyMode: '', threshold: '', commKey: '' });

  const { t } = useLanguage();
  const toast = useToast();

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/devices/provision');
        const json = await res.json();
        if (res.ok) {
          const list = (json.devices ?? []) as DeviceLite[];
          setDevices(list);
          setSn((prev) => prev || list[0]?.sn || '');
        } else {
          toast.error(json.error || t('prov_load_failed'));
        }
      } catch {
        toast.error(t('prov_load_failed'));
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(
    async (targetSn: string) => {
      if (!targetSn) return;
      try {
        const res = await fetch(`/api/devices/provision?sn=${encodeURIComponent(targetSn)}`);
        const json = await res.json();
        if (res.ok) setData(json as ProvisionData);
        else toast.error(json.error || t('prov_load_failed'));
      } catch {
        toast.error(t('prov_load_failed'));
      }
    },
    [t, toast],
  );

  useEffect(() => {
    void loadDetail(sn);
  }, [sn, loadDetail]);

  const runAction = useCallback(
    async (
      action: string,
      extra: Record<string, unknown> = {},
      successKey: TranslationKey = 'prov_queued',
    ) => {
      if (!sn) return;
      setIsBusy(action);
      try {
        const res = await fetch('/api/devices/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sn, action, ...extra }),
        });
        const json = await res.json();
        if (res.ok) {
          const skipped = Array.isArray(json.skipped) ? json.skipped.length : 0;
          toast.success(`${t(successKey)}${skipped ? ` (${skipped} skipped)` : ''}`);
          await loadDetail(sn);
        } else {
          toast.error(json.error || t('prov_action_failed'));
        }
      } catch {
        toast.error(t('prov_action_failed'));
      } finally {
        setIsBusy(null);
      }
    },
    [sn, t, toast, loadDetail],
  );

  const settingsMap = useMemo(() => {
    const map = new Map<string, string>();
    (data?.settings ?? []).forEach((row) => map.set(row.key, row.value ?? ''));
    return map;
  }, [data]);

  const confirmThenRun = async () => {
    if (!confirm) return;
    const { action, pin } = confirm;
    setConfirm(null);
    await runAction(action, pin ? { pin } : {});
  };

  const selectedDevice = devices.find((device) => device.sn === sn);

  return (
    <div className="animate-in fade-in space-y-6 duration-200">
      <PageHeader
        title={t('prov_title')}
        description={t('prov_subtitle')}
        actions={
          <>
            <Button
              variant="ghost"
              icon={RefreshCw}
              loading={isBusy === 'refresh'}
              onClick={() => {
                setIsBusy('refresh');
                void loadDetail(sn).finally(() => setIsBusy(null));
              }}
            >
              {t('refresh')}
            </Button>
          </>
        }
      />

      <Card className="sheen-top p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('prov_select_device')} className="sm:col-span-2">
            <Select value={sn} onChange={(event) => setSn(event.target.value)}>
              {devices.length === 0 && <option value="">{t('prov_no_devices')}</option>}
              {devices.map((device) => (
                <option key={device.sn} value={device.sn}>
                  {(device.name || device.sn) + (device.branch ? ` — ${device.branch}` : '')}
                </option>
              ))}
            </Select>
          </Field>

          <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
            <Button
              variant="secondary"
              icon={Clock}
              disabled={!sn}
              loading={isBusy === 'set_time'}
              onClick={() => void runAction('set_time')}
            >
              {t('prov_sync_clock')}
            </Button>
            <Button
              variant="secondary"
              icon={ShieldCheck}
              disabled={!sn}
              loading={isBusy === 'check'}
              onClick={() => void runAction('check')}
            >
              {t('prov_check')}
            </Button>
            <Button
              variant="secondary"
              icon={Download}
              disabled={!sn}
              loading={isBusy === 'query_attlog'}
              onClick={() => void runAction('query_attlog')}
            >
              {t('prov_pull_punches')}
            </Button>
          </div>
        </div>

        {selectedDevice && (
          <p className="mt-3 text-xs text-ink-subtle">
            <span className="font-mono">{selectedDevice.sn}</span>
            {' • '}
            {t('prov_last_active')}: {selectedDevice.last_active || '—'}
          </p>
        )}
      </Card>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        data && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricTile
              label={t('prov_metric_employees')}
              value={data.summary.employees}
              icon={Users}
              tone="brand"
            />
            <MetricTile
              label={t('prov_metric_on_device')}
              value={data.summary.onDevice}
              icon={MonitorSmartphone}
              tone="success"
            />
            <MetricTile
              label={t('prov_metric_missing')}
              value={data.summary.missingOnDevice}
              icon={Upload}
              tone={data.summary.missingOnDevice > 0 ? 'warning' : 'success'}
            />
            <MetricTile
              label={t('prov_metric_orphaned')}
              value={data.summary.orphanedOnDevice}
              icon={AlertTriangle}
              tone={data.summary.orphanedOnDevice > 0 ? 'warning' : 'success'}
            />
            <MetricTile
              label={t('prov_metric_templates')}
              value={data.summary.templates}
              icon={ShieldCheck}
              tone="info"
            />
          </div>
        )
      )}

      {data && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Diff */}
          <Card className="lg:col-span-2">
            <CardHeader
              title={t('prov_diff_title')}
              description={t('prov_diff_desc')}
              icon={ListChecks}
              actions={
                <Button
                  variant="primary"
                  size="sm"
                  icon={Upload}
                  disabled={!sn || data.summary.missingOnDevice === 0}
                  loading={isBusy === 'push_employees'}
                  onClick={() =>
                    void runAction('push_employees', {
                      pins: data.missingOnDevice.map((employee) => employee.pin),
                    })
                  }
                >
                  {t('prov_push_all')}
                </Button>
              }
            />

            <div className="flex gap-2 border-b border-line px-5 py-3">
              {(
                [
                  ['missing', t('prov_tab_missing'), data.summary.missingOnDevice],
                  ['orphaned', t('prov_tab_orphaned'), data.summary.orphanedOnDevice],
                  ['mismatch', t('prov_tab_mismatch'), data.summary.nameMismatches],
                ] as [DiffTab, string, number][]
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  className={
                    'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ' +
                    (tab === key
                      ? 'bg-brand-soft text-brand'
                      : 'text-ink-muted hover:bg-surface-2 hover:text-ink')
                  }
                >
                  {label} ({count})
                </button>
              ))}
            </div>

            <TableScroll>
              <Table caption={t('prov_diff_title')} className="min-w-[34rem]">
                <THead>
                  <tr>
                    <Th>{t('col_pin')}</Th>
                    <Th>{t('col_employee')}</Th>
                    <Th>{t('prov_col_detail')}</Th>
                    <Th align="end">{t('actions')}</Th>
                  </tr>
                </THead>
                <TBody>
                  {tab === 'missing' &&
                    data.missingOnDevice.map((employee, index) => (
                      <Tr
                        key={employee.pin}
                        className="stagger-in"
                        style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                      >
                        <Td numeric className="font-mono text-ink-muted">
                          {employee.pin}
                        </Td>
                        <Td className="font-semibold text-ink">
                          {employee.full_name || `PIN ${employee.pin}`}
                        </Td>
                        <Td className="text-ink-subtle">
                          {employee.department || '—'}
                          {employee.branch ? ` • ${employee.branch}` : ''}
                        </Td>
                        <Td align="end">
                          <Button
                            variant="subtle"
                            size="sm"
                            icon={Upload}
                            loading={isBusy === `push_employee:${employee.pin}`}
                            onClick={() =>
                              void runAction('push_employee', { pin: employee.pin })
                            }
                          >
                            {t('prov_push')}
                          </Button>
                        </Td>
                      </Tr>
                    ))}

                  {tab === 'orphaned' &&
                    data.orphanedOnDevice.map((user, index) => (
                      <Tr
                        key={user.pin}
                        className="stagger-in"
                        style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                      >
                        <Td numeric className="font-mono text-ink-muted">
                          {user.pin}
                        </Td>
                        <Td className="font-semibold text-ink">{user.name || '—'}</Td>
                        <Td className="text-ink-subtle">{t('prov_orphan_hint')}</Td>
                        <Td align="end">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Trash2}
                            className="text-danger"
                            onClick={() =>
                              setConfirm({
                                action: 'delete_user',
                                pin: user.pin,
                                title: t('prov_confirm_delete_user_title'),
                                description: t('prov_confirm_delete_user_desc'),
                                confirmLabel: t('delete'),
                              })
                            }
                          >
                            {t('delete')}
                          </Button>
                        </Td>
                      </Tr>
                    ))}

                  {tab === 'mismatch' &&
                    data.nameMismatches.map((row, index) => (
                      <Tr
                        key={row.pin}
                        className="stagger-in"
                        style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                      >
                        <Td numeric className="font-mono text-ink-muted">
                          {row.pin}
                        </Td>
                        <Td className="font-semibold text-ink">
                          {row.database_name || '—'}
                        </Td>
                        <Td className="text-ink-subtle">
                          {t('prov_device_name')}: {row.device_name || '—'}
                        </Td>
                        <Td align="end">
                          <Button
                            variant="subtle"
                            size="sm"
                            icon={Upload}
                            onClick={() => void runAction('push_employee', { pin: row.pin })}
                          >
                            {t('prov_fix')}
                          </Button>
                        </Td>
                      </Tr>
                    ))}

                  {((tab === 'missing' && data.missingOnDevice.length === 0) ||
                    (tab === 'orphaned' && data.orphanedOnDevice.length === 0) ||
                    (tab === 'mismatch' && data.nameMismatches.length === 0)) && (
                    <TableMessageRow colSpan={4}>
                      <p className="py-6 text-center text-xs text-ink-subtle">
                        {tab === 'missing'
                          ? t('prov_no_diff_missing')
                          : tab === 'orphaned'
                            ? t('prov_no_diff_orphaned')
                            : t('prov_no_diff_mismatch')}
                      </p>
                    </TableMessageRow>
                  )}
                </TBody>
              </Table>
            </TableScroll>
          </Card>

          {/* Templates + parameters */}
          <div className="space-y-6">
            <Card>
              <CardHeader title={t('prov_templates_title')} icon={ShieldCheck} />
              <div className="space-y-4 p-5">
                <p className="text-xs leading-relaxed text-ink-subtle">
                  {t('prov_templates_desc')}
                </p>
                <p className="text-xs text-ink-subtle">
                  {t('prov_stored_templates')}: <span className="font-semibold text-ink" data-numeric>{data.summary.templates}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    icon={Download}
                    disabled={!sn}
                    loading={isBusy === 'pull_templates'}
                    onClick={() =>
                      setConfirm({
                        action: 'pull_templates',
                        title: t('prov_confirm_pull_title'),
                        description: t('prov_confirm_pull_desc'),
                        confirmLabel: t('prov_pull_templates'),
                      })
                    }
                  >
                    {t('prov_pull_templates')}
                  </Button>
                  <Button
                    variant="secondary"
                    icon={RotateCcw}
                    disabled={!sn || data.summary.templates === 0}
                    loading={isBusy === 'restore_templates'}
                    onClick={() =>
                      setConfirm({
                        action: 'restore_templates',
                        title: t('prov_confirm_restore_title'),
                        description: t('prov_confirm_restore_desc'),
                        confirmLabel: t('prov_restore_templates'),
                      })
                    }
                  >
                    {t('prov_restore_templates')}
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader title={t('prov_params_title')} icon={Terminal} />
              <div className="space-y-4 p-5">
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label={t('prov_verify_mode')}
                    hint={settingsMap.get('VerifyMode') ? `${t('prov_last_value')}: ${settingsMap.get('VerifyMode')}` : undefined}
                  >
                    <Input
                      type="number"
                      min={0}
                      max={4}
                      value={params.verifyMode}
                      onChange={(event) =>
                        setParams((prev) => ({ ...prev, verifyMode: event.target.value }))
                      }
                      placeholder="0"
                    />
                  </Field>
                  <Field
                    label={t('prov_threshold')}
                    hint={settingsMap.get('MatchThreshold') ? `${t('prov_last_value')}: ${settingsMap.get('MatchThreshold')}` : undefined}
                  >
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={params.threshold}
                      onChange={(event) =>
                        setParams((prev) => ({ ...prev, threshold: event.target.value }))
                      }
                      placeholder="50"
                    />
                  </Field>
                </div>
                <Field
                  label={t('prov_comm_key')}
                  hint={settingsMap.get('CommKey') ? `${t('prov_last_value')}: ${settingsMap.get('CommKey')}` : undefined}
                >
                  <Input
                    type="number"
                    min={0}
                    max={999999}
                    value={params.commKey}
                    onChange={(event) =>
                      setParams((prev) => ({ ...prev, commKey: event.target.value }))
                    }
                    placeholder="0"
                  />
                </Field>
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!sn}
                  loading={isBusy === 'set_params'}
                  onClick={() =>
                    void runAction('set_params', {
                      verifyMode: params.verifyMode ? Number(params.verifyMode) : undefined,
                      threshold: params.threshold ? Number(params.threshold) : undefined,
                      commKey: params.commKey ? Number(params.commKey) : undefined,
                    })
                  }
                >
                  {t('prov_apply_params')}
                </Button>

                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={RefreshCw}
                    disabled={!sn}
                    onClick={() =>
                      setConfirm({
                        action: 'reboot',
                        title: t('prov_confirm_reboot_title'),
                        description: t('prov_confirm_reboot_desc'),
                        confirmLabel: t('prov_reboot'),
                      })
                    }
                  >
                    {t('prov_reboot')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    className="text-danger"
                    disabled={!sn}
                    onClick={() =>
                      setConfirm({
                        action: 'clear_log',
                        title: t('prov_confirm_clear_title'),
                        description: t('prov_confirm_clear_desc'),
                        confirmLabel: t('prov_clear_log'),
                      })
                    }
                  >
                    {t('prov_clear_log')}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Command queue */}
      {data && (
        <TableCard>
          <CardHeader
            title={t('prov_queue_title')}
            description={t('prov_queue_desc')}
            icon={Terminal}
            actions={
              <Badge tone="neutral" size="sm">
                {data.commands.length}
              </Badge>
            }
          />
          <TableScroll>
            <Table caption={t('prov_queue_title')} className="min-w-[46rem]">
              <THead>
                <tr>
                  <Th>{t('prov_col_seq')}</Th>
                  <Th>{t('prov_col_command')}</Th>
                  <Th>{t('col_status')}</Th>
                  <Th align="end">{t('prov_col_attempts')}</Th>
                  <Th>{t('col_date')}</Th>
                  <Th align="end">{t('actions')}</Th>
                </tr>
              </THead>
              <TBody>
                {data.commands.map((command, index) => (
                  <Tr
                    key={command.id}
                    className="stagger-in"
                    style={{ '--ui-i': Math.min(index, 12) } as CSSProperties}
                  >
                    <Td numeric className="font-mono text-ink-subtle">
                      {command.device_seq ?? '—'}
                    </Td>
                    <Td className="font-mono text-xs text-ink">{command.command_str}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[command.status] ?? 'neutral'} size="sm" dot>
                        {command.status}
                      </Badge>
                      {command.last_error && (
                        <p className="mt-1 max-w-[16rem] truncate text-[10px] text-danger">
                          {command.last_error}
                        </p>
                      )}
                    </Td>
                    <Td align="end" numeric className="font-mono text-ink-muted">
                      {command.attempts ?? 0}
                    </Td>
                    <Td className="font-mono text-xs text-ink-subtle">
                      {command.created_at ? command.created_at.slice(0, 19).replace('T', ' ') : '—'}
                    </Td>
                    <Td align="end">
                      {(command.status === 'FAILED' || command.status === 'SENT') && (
                        <Button
                          variant="subtle"
                          size="sm"
                          icon={RotateCcw}
                          loading={isBusy === `retry:${command.id}`}
                          onClick={() =>
                            void runAction('retry_command', { commandId: command.id })
                          }
                        >
                          {t('prov_retry')}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}

                {data.commands.length === 0 && (
                  <TableMessageRow colSpan={6}>
                    <EmptyState
                      icon={Terminal}
                      title={t('prov_queue_empty')}
                      description={t('prov_queue_empty_desc')}
                    />
                  </TableMessageRow>
                )}
              </TBody>
            </Table>
          </TableScroll>
        </TableCard>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => void confirmThenRun()}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel ?? t('confirm')}
        cancelLabel={t('cancel')}
        loading={isBusy !== null}
      />
    </div>
  );
}
