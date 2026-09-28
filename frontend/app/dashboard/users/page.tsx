'use client';
import { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw, ShieldCheck, UserCog } from 'lucide-react';
import { useLanguage } from '@/components/LanguageContext';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/ui/PageHeader';
import { TableSkeleton } from '@/components/ui/Skeleton';
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

type AppRole = 'owner' | 'admin' | 'operator' | 'viewer';

interface ManagedUser {
  user_id: string;
  email: string | null;
  last_sign_in_at: string | null;
  display_name: string | null;
  role: string | null;
  branch_scope: string[];
  /** Phase 7 — the roster row this login sees on "My Attendance". */
  employee_pin: string | null;
}

interface AuditEntry {
  id: string;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  at: string;
}

const ROLE_TONE: Record<string, BadgeTone> = {
  owner: 'brand',
  admin: 'success',
  operator: 'info',
  viewer: 'neutral',
};

const ROLE_KEY: Record<string, TranslationKey> = {
  owner: 'users_role_owner',
  admin: 'users_role_admin',
  operator: 'users_role_operator',
  viewer: 'users_role_viewer',
};

const ROLES: AppRole[] = ['owner', 'admin', 'operator', 'viewer'];

export default function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentRole, setCurrentRole] = useState<string>('viewer');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pinDraft, setPinDraft] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState<string | null>(null);

  const { t } = useLanguage();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      const json = await res.json();
      if (res.ok) {
        setUsers(json.users ?? []);
        setAudit(json.audit ?? []);
        setCurrentUserId(json.currentUserId ?? '');
        setCurrentRole(json.currentRole ?? 'viewer');
      } else {
        toast.error(json.error || t('users_load_failed'));
      }
    } catch {
      toast.error(t('users_load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    // Deferred off the effect path: the loader sets state, and calling it
    // synchronously here is what react-hooks/set-state-in-effect flags.
    void Promise.resolve().then(load);
  }, [load]);

  const saveRole = async (user: ManagedUser) => {
    const role = draft[user.user_id] ?? user.role ?? 'viewer';
    setIsBusy(user.user_id);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.user_id,
          role,
          employee_pin: (pinDraft[user.user_id] ?? user.employee_pin ?? '').trim(),
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(t('users_saved'));
        await load();
      } else {
        toast.error(json.error || t('users_save_failed'));
      }
    } catch {
      toast.error(t('users_save_failed'));
    } finally {
      setIsBusy(null);
    }
  };

  const isOwner = currentRole === 'owner';

  return (
    <div className="animate-in fade-in space-y-6 duration-200">
      <PageHeader
        title={t('users_title')}
        description={t('users_subtitle')}
        actions={
          <Button
            variant="ghost"
            icon={RefreshCw}
            loading={isBusy === 'refresh'}
            onClick={() => {
              setIsBusy('refresh');
              void load().finally(() => setIsBusy(null));
            }}
          >
            {t('refresh')}
          </Button>
        }
      />

      {!isOwner && (
        <p className="flex items-start gap-2.5 rounded-xl border border-warning-line bg-warning-soft px-4 py-3 text-xs font-medium text-warning">
          <ShieldCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('users_owner_only')}
        </p>
      )}

      <TableCard>
        <CardHeader
          title={t('users_roles_title')}
          description={`${t('users_roles_desc')} ${t('users_employee_hint')}`}
          icon={UserCog}
        />
        <TableScroll>            <Table caption={t('users_title')} className="min-w-[52rem]">
            <THead>
              <tr>
                <Th>{t('users_col_user')}</Th>
                <Th>{t('users_col_role')}</Th>
                <Th>{t('users_col_employee')}</Th>
                <Th>{t('users_col_last_signin')}</Th>
                <Th align="end">{t('actions')}</Th>
              </tr>
            </THead>
            <TBody>
              {isLoading && (
                <TableMessageRow colSpan={5}>
                  <TableSkeleton rows={4} columns={5} />
                </TableMessageRow>
              )}

              {!isLoading &&
                users.map((user) => (
                  <Tr key={user.user_id}>
                    <Td>
                      <p className="font-semibold text-ink">
                        {user.display_name || user.email || user.user_id}
                        {user.user_id === currentUserId && (
                          <span className="ms-2 text-[10px] font-bold tracking-wide text-brand uppercase">
                            {t('users_you')}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-subtle">{user.email}</p>
                    </Td>
                    <Td>
                      {user.role ? (
                        <Badge tone={ROLE_TONE[user.role] ?? 'neutral'} size="sm" dot>
                          {t(ROLE_KEY[user.role] ?? 'users_role_viewer')}
                        </Badge>
                      ) : (
                        <Badge tone="warning" size="sm">
                          {t('users_no_role')}
                        </Badge>
                      )}
                    </Td>
                    <Td>
                      <Input
                        aria-label={t('users_col_employee')}
                        className="w-28 text-center font-mono"
                        placeholder="—"
                        disabled={!isOwner}
                        value={pinDraft[user.user_id] ?? user.employee_pin ?? ''}
                        onChange={(event) =>
                          setPinDraft((prev) => ({ ...prev, [user.user_id]: event.target.value }))
                        }
                      />
                    </Td>
                    <Td className="font-mono text-xs text-ink-subtle">
                      {user.last_sign_in_at
                        ? user.last_sign_in_at.slice(0, 19).replace('T', ' ')
                        : '—'}
                    </Td>
                    <Td align="end">
                      <div className="inline-flex items-center gap-2">
                        <Select
                          aria-label={t('users_col_role')}
                          className="w-36"
                          disabled={!isOwner}
                          value={draft[user.user_id] ?? user.role ?? 'viewer'}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, [user.user_id]: event.target.value }))
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {t(ROLE_KEY[role])}
                            </option>
                          ))}
                        </Select>
                        <Button
                          variant="subtle"
                          size="sm"
                          disabled={!isOwner}
                          loading={isBusy === user.user_id}
                          onClick={() => void saveRole(user)}
                        >
                          {t('users_save')}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}

              {!isLoading && users.length === 0 && (
                <TableMessageRow colSpan={5}>
                  <EmptyState icon={UserCog} title={t('users_empty')} />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableCard>

      <Card>
        <CardHeader title={t('audit_title')} description={t('audit_desc')} icon={History} />
        <TableScroll>
          <Table caption={t('audit_title')} className="min-w-[40rem]">
            <THead>
              <tr>
                <Th>{t('audit_col_at')}</Th>
                <Th>{t('audit_col_action')}</Th>
                <Th>{t('audit_col_entity')}</Th>
                <Th>{t('audit_col_actor')}</Th>
              </tr>
            </THead>
            <TBody>
              {audit.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="font-mono text-xs text-ink-subtle">
                    {entry.at?.slice(0, 19).replace('T', ' ')}
                  </Td>
                  <Td className="font-mono text-xs font-semibold text-ink">{entry.action}</Td>
                  <Td className="text-ink-muted">
                    {entry.entity}
                    {entry.entity_id ? (
                      <span className="ms-1 font-mono text-[10px] text-ink-subtle">
                        {entry.entity_id.slice(0, 8)}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-[11px] text-ink-subtle">
                    {entry.actor ? entry.actor.slice(0, 8) : '—'}
                  </Td>
                </Tr>
              ))}

              {audit.length === 0 && (
                <TableMessageRow colSpan={4}>
                  <EmptyState icon={History} title={t('audit_empty')} />
                </TableMessageRow>
              )}
            </TBody>
          </Table>
        </TableScroll>
      </Card>
    </div>
  );
}
