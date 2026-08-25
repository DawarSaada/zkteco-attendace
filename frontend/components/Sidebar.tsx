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
    Fingerprint
} from 'lucide-react';

interface SidebarProps {
    userEmail?: string;
    onLogout: () => Promise<void>;
}

export function Sidebar({ userEmail, onLogout }: SidebarProps) {
    const pathname = usePathname();

    const navItems = [
        { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
        { href: '/dashboard/live', label: 'Live Monitor', icon: Activity, badge: 'Live' },
        { href: '/dashboard/reports', label: 'Reports', icon: FileSpreadsheet },
        { href: '/dashboard/employees', label: 'Employees', icon: Users },
        { href: '/dashboard/shifts', label: 'Shifts & Schedule', icon: Clock },
        { href: '/dashboard/devices', label: 'Terminal Devices', icon: MonitorSmartphone },
    ];

    return (
        <aside className="w-64 bg-white dark:bg-[#0c121e] border-r border-slate-200 dark:border-slate-800/80 flex flex-col shrink-0 min-h-screen sticky top-0 h-screen transition-colors duration-200 z-40">
            {/* Brand Header */}
            <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800/80 gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
                    <Fingerprint size={20} />
                </div>
                <div>
                    <h1 className="font-bold text-base tracking-tight text-slate-900 dark:text-white leading-tight">
                        BioTime <span className="text-blue-600 dark:text-blue-400 font-semibold text-xs px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/50">Pro</span>
                    </h1>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Attendance Management</p>
                </div>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
                <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    Main Menu
                </div>
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href;

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                                isActive
                                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30 dark:shadow-blue-500/20'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-200'
                            }`}
                        >
                            <div className="flex items-center space-x-3">
                                <Icon size={18} className={isActive ? 'text-white' : 'text-slate-400 dark:text-slate-400'} />
                                <span>{item.label}</span>
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
                    <div className="flex items-center space-x-2">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">ADMS Server</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Online</span>
                </div>

                <div className="flex items-center justify-between px-2 pt-1">
                    <div className="truncate max-w-[145px]">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{userEmail || 'Administrator'}</p>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">Authenticated</p>
                    </div>
                    <form action={onLogout}>
                        <button
                            type="submit"
                            title="Sign Out"
                            className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                        >
                            <LogOut size={16} />
                        </button>
                    </form>
                </div>
            </div>
        </aside>
    );
}
