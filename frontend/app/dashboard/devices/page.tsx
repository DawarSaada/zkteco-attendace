'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MonitorSmartphone, Power, RefreshCw, RotateCw, Wifi } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChartLegend, Donut } from '@/components/ui/Charts';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Field, Input } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { DeviceDataPanel } from '@/components/DeviceDataPanel';
import { CardGridSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils/cn';
import type { Device } from '@/types';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const SYNC_COMMAND = 'DATA QUERY ATTLOG';

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingAction, setLoadingAction] = useState<string>('');
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [rebootTarget, setRebootTarget] = useState<Device | null>(null);
  const [editName, setEditName] = useState('');
  const [editBranch, setEditBranch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Held in state rather than read during render, so online/offline badges stay
  // consistent for a whole render pass and refresh themselves over time.
  const [nowTs, setNowTs] = useState<number | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const { t } = useLanguage();
  const toast = useToast();

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/devices');
      if (res.ok) {
        const data = await res.json();
        setDevices(Array.isArray(data) ? data : []);
      } else {
        toast.error(t('dev_fetch_failed'));
        setDevices([]);
      }
    } catch {
      toast.error(t('dev_fetch_failed'));
      setDevices([]);
    } finally {
      setIsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    const sync = () => setNowTs(Date.now());
    const frame = requestAnimationFrame(sync);
    const heartbeat = setInterval(sync, 30_000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(heartbeat);
    };
  }, []);

  useEffect(() => {
    void fetchDevices();

    const channel = supabase
      .channel('realtime_devices_page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => {
        void fetchDevices();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchDevices, supabase]);

  const sendCommand = async (sn: string, commandStr: string) => {
    setLoadingAction(`${sn}_${commandStr}`);
    try {
      const res = await fetch('/api/devices/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sn, command_str: commandStr }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('dev_cmd_queued'));
      } else {
        toast.error(data.error || t('dev_command_failed'));
      }
    } catch {
      toast.error(t('dev_command_failed'));
    } finally {
      setLoadingAction('');
    }
  };

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingDevice) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/devices/${editingDevice.sn}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, branch: editBranch }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('dev_save_success'));
        setEditingDevice(null);
        void fetchDevices();
      } else {
        toast.error(data.error || t('dev_update_failed'));
      }
    } catch {
      toast.error(t('dev_update_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const openEditModal = (device: Device) => {
    setEditingDevice(device);
    setEditName(device.name || '');
    setEditBranch(device.branch || '');
  };

  const isDeviceOnline = (lastActive: string | null | undefined) =>
    nowTs !== null &&
    Boolean(lastActive) &&
    nowTs - new Date(lastActive as string).getTime() < ONLINE_WINDOW_MS;

  const onlineCount = devices.filter((device) =>
    isDeviceOnline(device.last_active),
  ).length;
  const offlineCount = devices.length - onlineCount;
  const uptime = devices.length > 0 ? Math.round((onlineCount / devices.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('nav_devices')}
        title={t('dev_title')}
        description={t('dev_subtitle')}
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void fetchDevices()}
            aria-label={t('refresh')}
            title={t('refresh')}
          >
            <RefreshCw size={16} />
          </Button>
        }
      />

      {!isLoading && devices.length > 0 && (
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-5 p-5">
          <Donut
            size={128}
            thickness={13}
            centerLabel={`${uptime}%`}
            centerSub={t('dev_online_count')}
            segments={[
              { label: t('dev_online_count'), value: onlineCount, tone: 'success' },
              { label: t('dev_offline_count'), value: offlineCount, tone: 'danger' },
            ]}
          />

          <ChartLegend
            className="min-w-[11rem] flex-1"
            segments={[
              { label: t('dev_online_count'), value: onlineCount, tone: 'success' },
              { label: t('dev_offline_count'), value: offlineCount, tone: 'danger' },
            ]}
          />

          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-4 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-brand-line bg-brand-soft text-brand">
              <Wifi size={16} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[10px] font-bold tracking-[0.1em] text-ink-subtle uppercase">
                {t('stat_terminals')}
              </p>
              <p className="text-lg leading-none font-bold text-ink" data-numeric>
                {devices.length}
              </p>
            </div>
          </div>
        </Card>
      )}

      {isLoading ? (
        <CardGridSkeleton count={3} />
      ) : devices.length === 0 ? (
        <EmptyState
          tone="dashed"
          icon={MonitorSmartphone}
          title={t('dev_no_devices')}
          description={t('dev_no_devices_desc')}
          className="py-16"
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {devices.map((device, index) => {
            const lastActive = new Date(device.last_active);
            const isOnline = isDeviceOnline(device.last_active);
            const syncKey = `${device.sn}_${SYNC_COMMAND}`;
            const rebootKey = `${device.sn}_REBOOT`;

            return (
              <Card
                key={device.sn}
                interactive
                style={{ '--ui-i': Math.min(index, 8) } as React.CSSProperties}
                className="stagger-in flex flex-col p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        'grid h-10 w-10 shrink-0 place-items-center rounded-xl border',
                        isOnline
                          ? 'glow-current border-success-line bg-success-soft text-success'
                          : 'border-line bg-surface-2 text-ink-subtle',
                      )}
                    >
                      <MonitorSmartphone size={18} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-ink">
                        {device.name || (
                          <span className="text-ink-subtle italic">
                            {t('dev_unnamed')}
                          </span>
                        )}
                      </h3>
                      <p className="truncate font-mono text-[11px] text-ink-subtle">
                        {device.sn}
                      </p>
                    </div>
                  </div>

                  <Badge
                    tone={isOnline ? 'success' : 'danger'}
                    dot
                    pulse={isOnline}
                    className="shrink-0"
                  >
                    {isOnline ? t('dev_online') : t('dev_offline')}
                  </Badge>
                </div>

                <dl className="mt-4 space-y-2 border-y border-line py-3.5 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-subtle">{t('col_branch')}</dt>
                    <dd className="truncate font-semibold text-ink">
                      {device.branch || t('unassigned')}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-subtle">{t('dev_ip_address')}</dt>
                    <dd className="truncate font-mono text-ink-muted">
                      {device.ip_address || t('dev_dhcp')}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-subtle">{t('dev_last_heartbeat')}</dt>
                    <dd className="truncate font-mono text-ink-muted" data-numeric>
                      {lastActive.toLocaleTimeString()}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 grid flex-1 grid-cols-2 gap-2">
                  <Button
                    variant="subtle"
                    size="sm"
                    icon={RotateCw}
                    loading={loadingAction === syncKey}
                    loadingLabel={t('saving')}
                    onClick={() => void sendCommand(device.sn, SYNC_COMMAND)}
                  >
                    {t('dev_sync_logs')}
                  </Button>
                  <Button
                    variant="subtle"
                    size="sm"
                    icon={Power}
                    loading={loadingAction === rebootKey}
                    loadingLabel={t('saving')}
                    onClick={() => setRebootTarget(device)}
                  >
                    {t('dev_reboot')}
                  </Button>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditModal(device)}
                  className="mt-2"
                >
                  {t('edit')}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      {/* Which ADMS tables each terminal actually delivers, and which we discard. */}
      {!isLoading && devices.length > 0 && <DeviceDataPanel />}

      <Modal
        open={editingDevice !== null}
        onClose={() => setEditingDevice(null)}
        title={t('dev_edit_settings')}
        description={
          editingDevice ? `${t('dev_sn_label')}: ${editingDevice.sn}` : undefined
        }
        closeLabel={t('close')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditingDevice(null)}>
              {t('cancel')}
            </Button>
            <Button type="submit" form="device-edit-form" loading={isSaving}>
              {t('save')}
            </Button>
          </>
        }
      >
        <form id="device-edit-form" onSubmit={handleSaveEdit} className="space-y-4">
          <Field label={t('dev_custom_name')}>
            <Input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              placeholder={t('dev_name_placeholder')}
            />
          </Field>
          <Field label={t('dev_branch_location')}>
            <Input
              value={editBranch}
              onChange={(event) => setEditBranch(event.target.value)}
              placeholder={t('dev_branch_placeholder')}
            />
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={rebootTarget !== null}
        onClose={() => setRebootTarget(null)}
        onConfirm={() => {
          if (rebootTarget) void sendCommand(rebootTarget.sn, 'REBOOT');
          setRebootTarget(null);
        }}
        title={t('dev_reboot_confirm_title')}
        description={t('dev_reboot_confirm_desc')}
        details={
          rebootTarget && (
            <p className="font-mono text-ink-muted">
              {rebootTarget.name || t('dev_unnamed')} • {rebootTarget.sn}
            </p>
          )
        }
        confirmLabel={t('dev_reboot')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
