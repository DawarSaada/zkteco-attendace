'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import {
  LayoutDashboard,
  Activity,
  FileSpreadsheet,
  MonitorSmartphone,
  Users,
  Clock,
  LogOut,
  Fingerprint,
  MailCheck,
  Terminal,
  CalendarOff,
  CalendarCheck,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useNav } from '@/components/NavContext';
import { useLanguage } from '@/components/LanguageContext';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils/cn';
import type { IconComponent } from '@/components/ui/icon';
import type { TranslationKey } from '@/lib/i18n/translations';
import type { AppRole } from '@/lib/auth/roles';

interface SidebarProps {
  userEmail?: string;
  role?: AppRole;
  onLogout: () => Promise<void>;
}

interface NavItem {
  href: string;
  labelKey: TranslationKey;
  icon: IconComponent;
  badgeKey?: TranslationKey;
  /** Omitted means every signed-in user may see it. */
  roles?: AppRole[];
}

/** Anyone who is not a viewer works with the org-wide screens. */
const ADMIN: AppRole[] = ['owner', 'admin', 'operator'];

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav_overview', icon: LayoutDashboard },
  { href: '/dashboard/me', labelKey: 'nav_me', icon: CalendarCheck },
  { href: '/dashboard/live', labelKey: 'nav_live', icon: Activity, badgeKey: 'live_badge', roles: ADMIN },
  { href: '/dashboard/reports', labelKey: 'nav_reports', icon: FileSpreadsheet, roles: ADMIN },
  { href: '/dashboard/leave', labelKey: 'nav_leave', icon: CalendarOff, roles: ADMIN },
  { href: '/dashboard/automation', labelKey: 'nav_automation', icon: MailCheck, roles: ADMIN },
  { href: '/dashboard/employees', labelKey: 'nav_employees', icon: Users, roles: ADMIN },
  { href: '/dashboard/shifts', labelKey: 'nav_shifts', icon: Clock, roles: ADMIN },
  { href: '/dashboard/devices', labelKey: 'nav_devices', icon: MonitorSmartphone, roles: ADMIN },
  { href: '/dashboard/provisioning', labelKey: 'nav_provisioning', icon: Terminal, roles: ADMIN },
  { href: '/dashboard/users', labelKey: 'nav_users', icon: ShieldCheck, roles: ADMIN },
];

export function Sidebar({ userEmail, role, onLogout }: SidebarProps) {
  // A viewer is an employee, not an operator: they get their own attendance and
  // nothing else. This is cosmetic — every admin route still checks the role
  // server-side — but a screen full of "Forbidden" is not a product.
  const navItems = NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));
  const pathname = usePathname();
  const { mobileOpen, setMobileOpen } = useNav();
  const { t, isRTL } = useLanguage();

  // Lock background scrolling and allow Escape while the drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileOpen, setMobileOpen]);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  const panel = (
    <div className="sheen-top relative flex h-full flex-col overflow-hidden border-e border-line bg-surface/70 backdrop-blur-xl">
      {/* Aurora wash behind the brand block */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -start-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,var(--canvas-glow-1),transparent_65%)] blur-2xl"
      />

      {/* Brand */}
      <div className="relative flex h-[68px] shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="sheen-top aurora-bg glow-brand grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white">
            <Fingerprint size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-bold tracking-tight text-ink">
                {t('app_title')}
              </span>
              <span className="aurora-ring rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-brand uppercase">
                Pro
              </span>
            </div>
            <p className="truncate text-[10px] font-medium text-ink-subtle">
              {t('app_subtitle')}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label={t('close_menu')}
          className="-me-1 grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-ink-subtle transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
        >
          <X size={17} />
        </button>
      </div>

      {/* Navigation */}
      <nav
        aria-label={t('nav_main_menu')}
        className="relative flex-1 space-y-1 overflow-y-auto px-3 py-4"
      >
        <p className="px-3 pb-2 text-[9px] font-bold tracking-[0.16em] text-ink-subtle uppercase">
          {t('nav_main_menu')}
        </p>

        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
                active
                  ? 'sheen-top aurora-bg glow-brand font-semibold text-white'
                  : 'text-ink-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon
                  size={17}
                  aria-hidden="true"
                  className={cn(
                    'shrink-0 transition-colors',
                    active
                      ? 'text-white'
                      : 'text-ink-subtle group-hover:text-brand',
                  )}
                />
                <span className="truncate">{t(item.labelKey)}</span>
              </span>

              {item.badgeKey && (
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase',
                    active
                      ? 'bg-white/20 text-white'
                      : 'border border-success-line bg-success-soft text-success',
                  )}
                >
                  {!active && (
                    <span className="relative flex h-1 w-1">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                      <span className="relative inline-flex h-1 w-1 rounded-full bg-emerald-500" />
                    </span>
                  )}
                  {t(item.badgeKey)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="relative space-y-2.5 border-t border-line p-3">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
          <span className="text-[11px] font-medium text-ink-muted">
            {t('server_status')}
          </span>
          <Badge tone="neutral" size="sm">
            {t('stat_adms_protocol')}
          </Badge>
        </div>

        <div className="flex items-center justify-between gap-3 px-0.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={userEmail || 'Administrator'} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink">
                {userEmail || t('administrator')}
              </p>
              <p className="truncate text-[10px] text-ink-subtle">
                {t('authenticated')}
              </p>
            </div>
          </div>

          <form action={onLogout}>
            <button
              type="submit"
              title={t('sign_out')}
              aria-label={t('sign_out')}
              className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-ink-subtle transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
            >
              <LogOut size={15} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 z-40 hidden h-screen min-h-screen w-[15.5rem] shrink-0 lg:block">
        {panel}
      </aside>

      {/* Mobile off-canvas drawer */}
      {mobileOpen && (
        <div
          id="dashboard-nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t('open_menu')}
          className="fixed inset-0 z-50 lg:hidden"
        >
          <div
            className="animate-in fade-in absolute inset-0 bg-[var(--overlay)] backdrop-blur-md duration-200"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            className={cn(
              'absolute inset-y-0 start-0 w-72 max-w-[85vw] shadow-pop',
              'animate-in duration-200',
              isRTL ? 'slide-in-from-right' : 'slide-in-from-left',
            )}
          >
            {panel}
          </div>
        </div>
      )}
    </>
  );
}
