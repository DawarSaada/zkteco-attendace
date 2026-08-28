'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
    MonitorSmartphone, 
    Users, 
    Clock, 
    ArrowRight, 
    ArrowLeft,
    Activity, 
    FileSpreadsheet, 
    ShieldCheck
} from 'lucide-react';
import { Device, Employee } from '@/types';
import { useLanguage } from '@/components/LanguageContext';

export default function DashboardOverview() {
    const [stats, setStats] = useState({ 
        devices: 0, 
        onlineDevices: 0, 
        employees: 0, 
        todayPunches: 0 
    });
    const [loading, setLoading] = useState(true);
    const { t, isRTL } = useLanguage();

    const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const [devicesRes, employeesRes] = await Promise.all([
                    fetch('/api/devices'),
                    fetch('/api/employees')
                ]);
                
                const devices: Device[] = devicesRes.ok ? await devicesRes.json() : [];
                const employees: Employee[] = employeesRes.ok ? await employeesRes.json() : [];

                const onlineCount = devices.filter(d => {
                    const diff = new Date().getTime() - new Date(d.last_active).getTime();
                    return diff < 5 * 60 * 1000;
                }).length;

                setStats({ 
                    devices: Array.isArray(devices) ? devices.length : 0,
                    onlineDevices: onlineCount,
                    employees: Array.isArray(employees) ? employees.length : 0,
                    todayPunches: 0
                });
            } catch (err: unknown) {
                console.error('Error loading dashboard stats:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    return (
        <div className="space-y-8 animate-in fade-in duration-200">
            {/* Header Banner */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        {t('overview_title')}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t('overview_subtitle')}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <Link
                        href="/dashboard/live"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
                    >
                        <Activity size={16} />
                        <span>{t('nav_live')}</span>
                    </Link>
                    <Link
                        href="/dashboard/reports"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 text-sm font-semibold transition-all cursor-pointer"
                    >
                        <FileSpreadsheet size={16} />
                        <span>{t('nav_reports')}</span>
                    </Link>
                </div>
            </div>

            {/* Stat Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Total Devices */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col justify-between transition-all hover:border-slate-300 dark:hover:border-slate-700">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t('stat_terminals')}
                        </span>
                        <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                            <MonitorSmartphone size={20} />
                        </div>
                    </div>
                    <div className="mt-4">
                        <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                            {loading ? '...' : stats.devices}
                        </p>
                        <div className="flex items-center gap-1.5 mt-2">
                            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                {stats.onlineDevices} {t('server_online')} / {stats.devices - stats.onlineDevices} {t('dev_offline')}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Enrolled Employees */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col justify-between transition-all hover:border-slate-300 dark:hover:border-slate-700">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t('stat_employees')}
                        </span>
                        <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/50">
                            <Users size={20} />
                        </div>
                    </div>
                    <div className="mt-4">
                        <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                            {loading ? '...' : stats.employees}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-2">
                            {t('stat_registered_profiles')}
                        </p>
                    </div>
                </div>

                {/* System Status */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col justify-between transition-all hover:border-slate-300 dark:hover:border-slate-700">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t('stat_security_guard')}
                        </span>
                        <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50">
                            <ShieldCheck size={20} />
                        </div>
                    </div>
                    <div className="mt-4">
                        <p className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                            {t('authenticated')}
                        </p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-2">
                            {t('stat_session_active')}
                        </p>
                    </div>
                </div>

                {/* ADMS Protocol */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col justify-between transition-all hover:border-slate-300 dark:hover:border-slate-700">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            {t('stat_adms_protocol')}
                        </span>
                        <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/50">
                            <Clock size={20} />
                        </div>
                    </div>
                    <div className="mt-4">
                        <p className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                            Port 8088 / HTTP
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-2">
                            {t('stat_adms_info')}
                        </p>
                    </div>
                </div>
            </div>

            {/* Quick Actions & Navigation Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Link
                    href="/dashboard/live"
                    className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs hover:border-blue-500 dark:hover:border-blue-500 group transition-all"
                >
                    <div className="flex items-center justify-between mb-3">
                        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
                            <Activity size={22} />
                        </div>
                        <ArrowIcon size={18} className={`text-slate-400 group-hover:text-blue-500 transition-all ${isRTL ? 'group-hover:-translate-x-1' : 'group-hover:translate-x-1'}`} />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {t('quick_live_title')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {t('quick_live_desc')}
                    </p>
                </Link>

                <Link
                    href="/dashboard/reports"
                    className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs hover:border-blue-500 dark:hover:border-blue-500 group transition-all"
                >
                    <div className="flex items-center justify-between mb-3">
                        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                            <FileSpreadsheet size={22} />
                        </div>
                        <ArrowIcon size={18} className={`text-slate-400 group-hover:text-blue-500 transition-all ${isRTL ? 'group-hover:-translate-x-1' : 'group-hover:translate-x-1'}`} />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {t('quick_reports_title')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {t('quick_reports_desc')}
                    </p>
                </Link>

                <Link
                    href="/dashboard/devices"
                    className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs hover:border-blue-500 dark:hover:border-blue-500 group transition-all"
                >
                    <div className="flex items-center justify-between mb-3">
                        <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
                            <MonitorSmartphone size={22} />
                        </div>
                        <ArrowIcon size={18} className={`text-slate-400 group-hover:text-blue-500 transition-all ${isRTL ? 'group-hover:-translate-x-1' : 'group-hover:translate-x-1'}`} />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {t('quick_devices_title')}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {t('quick_devices_desc')}
                    </p>
                </Link>
            </div>
        </div>
    );
}
