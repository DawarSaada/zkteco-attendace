'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
    LayoutDashboard, 
    Activity, 
    FileSpreadsheet, 
    MonitorSmartphone, 
    Users, 
    Clock, 
    LogOut,
    Fingerprint,
    X
} from 'lucide-react';
import { useNav } from '@/components/NavContext';
import { useLanguage } from '@/components/LanguageContext';
import { TranslationKey } from '@/lib/i18n/translations';

interface SidebarProps {
    userEmail?: string;
    onLogout: () => Promise<void>;
}

export function Sidebar({ userEmail, onLogout }: SidebarProps) {
    const pathname = usePathname();
    const { mobileOpen, setMobileOpen } = useNav();
    const { t, isRTL } = useLanguage();

    const navItems: Array<{ href: string; labelKey: TranslationKey; icon: any; badge?: string }> = [
        { href: '/dashboard', labelKey: 'nav_overview', icon: LayoutDashboard },
        { href: '/dashboard/live', labelKey: 'nav_live', icon: Activity, badge: 'Live' },
        { href: '/dashboard/reports', labelKey: 'nav_reports', icon: FileSpreadsheet },
        { href: '/dashboard/employees', labelKey: 'nav_employees', icon: Users },
        { href: '/dashboard/shifts', labelKey: 'nav_shifts', icon: Clock },
        { href: '/dashboard/devices', labelKey: 'nav_devices', icon: MonitorSmartphone },
    ];

    const sidebarContent = (
        <div className="flex flex-col h-full bg-white dark:bg-[#0c121e] border-r rtl:border-r-0 rtl:border-l border-slate-200 dark:border-slate-800/80 transition-colors duration-200">
            {/* Brand Header */}
            <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-800/80">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
                        <Fingerprint size={20} />
                    </div>
                    <div>
                        <h1 className="font-bold text-base tracking-tight text-slate-900 dark:text-white leading-tight">
                            {t('app_title')} <span className="text-blue-600 dark:text-blue-400 font-semibold text-xs px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/50">Pro</span>
                        </h1>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{t('app_subtitle')}</p>
                    </div>
                </div>

                {/* Close Button on Mobile */}
                <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
                <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {t('nav_main_menu')}
                </div>
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileOpen(false)}
                            className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                                isActive
                                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30 dark:shadow-blue-500/20'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                        >
                            <div className="flex items-center space-x-3 rtl:space-x-reverse">
                                <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400 dark:text-slate-400'} />
                                <span>{t(item.labelKey)}</span>
                            </div>
                            {item.badge && (
                                <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-md ${
                                    isActive 
                                        ? 'bg-white/20 text-white' 
                                        : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 animate-pulse'
                                }`}>
                                    {item.badge}
                                </span>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* System Status / User Footer */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 space-y-2">
                <div className="px-3 py-2 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200/80 dark:border-slate-800/60 flex items-center justify-between">
                    <div className="flex items-center space-x-2 rtl:space-x-reverse">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">{t('server_status')}</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">{t('server_online')}</span>
                </div>

                <div className="flex items-center justify-between px-2 pt-1">
                    <div className="truncate max-w-[145px]">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{userEmail || t('administrator')}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{t('authenticated')}</p>
                    </div>
                    <form action={onLogout}>
                        <button
                            type="submit"
                            title={t('sign_out')}
                            className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                            <LogOut size={16} />
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );

    return (
        <>
            {/* Desktop Fixed Sidebar */}
            <aside className="hidden lg:block w-64 shrink-0 min-h-screen sticky top-0 h-screen z-40">
                {sidebarContent}
            </aside>

            {/* Mobile Off-Canvas Drawer */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden animate-in fade-in duration-200">
                    {/* Backdrop */}
                    <div 
                        className="fixed inset-0 bg-black/60 backdrop-blur-xs" 
                        onClick={() => setMobileOpen(false)} 
                    />
                    
                    {/* Drawer Panel */}
                    <div className={`relative w-72 max-w-[85vw] h-full shadow-2xl animate-in duration-200 z-10 ${
                        isRTL ? 'slide-in-from-right mr-auto' : 'slide-in-from-left ml-auto'
                    }`}>
                        {sidebarContent}
                    </div>
                </div>
            )}
        </>
    );
}
