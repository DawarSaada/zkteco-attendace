'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AttendanceLog } from '@/types';
import { formatPunchTime } from '@/lib/utils/formatTime';
import { SortHeader } from '@/components/SortHeader';
import { useLanguage } from '@/components/LanguageContext';
import { 
    Activity, 
    RotateCw, 
    Search, 
    Fingerprint, 
    ScanFace, 
    KeyRound, 
    MonitorSmartphone
} from 'lucide-react';

export default function LiveMonitor() {
    const [logs, setLogs] = useState<AttendanceLog[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [sortKey, setSortKey] = useState<string>('timestamp');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

    const supabase = useMemo(() => createClient(), []);
    const { t, isRTL } = useLanguage();

    const fetchLogs = useCallback(async (isManualTrigger = false) => {
        if (isManualTrigger) setIsRefreshing(true);
        try {
            const [{ data: logsData, error: logsError }, { data: empData }] = await Promise.all([
                supabase
                    .from('attendance_logs')
                    .select('*')
                    .order('timestamp', { ascending: false })
                    .limit(50),
                supabase
                    .from('employees')
                    .select('pin, full_name, branch, department')
            ]);
            
            if (!logsError && logsData) {
                const empMap = new Map<string, { full_name: string; branch?: string | null; department?: string | null }>();
                (empData || []).forEach(e => {
                    empMap.set(e.pin, e);
                });

                const joinedLogs: AttendanceLog[] = logsData.map(log => ({
                    ...log,
                    employees: empMap.get(log.pin) || null
                }));

                setLogs(joinedLogs);
                setLastUpdated(new Date());
            } else if (logsError) {
                console.error('[Live Monitor] Error fetching logs:', logsError.message);
            }
        } catch (err: unknown) {
            console.error('[Live Monitor] Catch error:', err);
        } finally {
            if (isManualTrigger) {
                setTimeout(() => setIsRefreshing(false), 400);
            }
        }
    }, [supabase]);

    useEffect(() => {
        fetchLogs();

        const pollInterval = setInterval(() => {
            fetchLogs();
        }, 4000);

        const channel = supabase
            .channel('realtime_live_logs_stream')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
                async (payload) => {
                    const newLog = payload.new as AttendanceLog;
                    const { data: empData } = await supabase
                        .from('employees')
                        .select('full_name, branch, department')
                        .eq('pin', newLog.pin)
                        .maybeSingle();

                    setLogs((prev) => {
                        const exists = prev.some(l => l.id === newLog.id || (l.pin === newLog.pin && l.timestamp === newLog.timestamp));
                        if (exists) return prev;
                        return [{ ...newLog, employees: empData }, ...prev].slice(0, 50);
                    });
                    setLastUpdated(new Date());
                }
            )
            .subscribe();

        return () => {
            clearInterval(pollInterval);
            supabase.removeChannel(channel);
        };
    }, [fetchLogs, supabase]);

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortOrder('asc');
        }
    };

    const sortedAndFilteredLogs = useMemo(() => {
        let result = logs.filter(log => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            const empName = log.employees?.full_name?.toLowerCase() || '';
            const pin = String(log.pin).toLowerCase();
            const sn = (log.sn || '').toLowerCase();
            return empName.includes(term) || pin.includes(term) || sn.includes(term);
        });

        result.sort((a, b) => {
            let valA: any = '';
            let valB: any = '';

            switch (sortKey) {
                case 'employee':
                    valA = a.employees?.full_name || `Employee ${a.pin}`;
                    valB = b.employees?.full_name || `Employee ${b.pin}`;
                    return sortOrder === 'asc' 
                        ? valA.localeCompare(valB) 
                        : valB.localeCompare(valA);

                case 'pin':
                    valA = Number(a.pin) || 0;
                    valB = Number(b.pin) || 0;
                    return sortOrder === 'asc' ? valA - valB : valB - valA;

                case 'timestamp':
                    valA = new Date(a.timestamp).getTime();
                    valB = new Date(b.timestamp).getTime();
                    return sortOrder === 'asc' ? valA - valB : valB - valA;

                case 'status':
                    valA = String(a.status || '0');
                    valB = String(b.status || '0');
                    return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

                case 'verify_mode':
                    valA = String(a.verify_mode || '0');
                    valB = String(b.verify_mode || '0');
                    return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

                case 'source':
                    valA = a.is_manual ? 'Manual' : (a.sn || '');
                    valB = b.is_manual ? 'Manual' : (b.sn || '');
                    return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

                default:
                    return 0;
            }
        });

        return result;
    }, [logs, searchTerm, sortKey, sortOrder]);

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                            {t('live_title')}
                        </h2>
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <span>{t('live_streaming')}</span>
                        </span>
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t('live_subtitle')} {lastUpdated.toLocaleTimeString()}.
                    </p>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    {/* Search Input */}
                    <div className="relative flex-1 sm:w-64">
                        <Search size={16} className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${isRTL ? 'right-3' : 'left-3'}`} />
                        <input
                            type="text"
                            placeholder={t('live_search_placeholder')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className={`w-full py-2 rounded-xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-2xs ${
                                isRTL ? 'pr-9 pl-3' : 'pl-9 pr-3'
                            }`}
                        />
                    </div>

                    {/* Manual Refresh Button */}
                    <button
                        type="button"
                        onClick={() => fetchLogs(true)}
                        disabled={isRefreshing}
                        title={t('refresh')}
                        className="p-2 rounded-xl bg-white dark:bg-[#0c121e] hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                        <RotateCw size={18} className={isRefreshing ? 'animate-spin text-blue-500' : ''} />
                    </button>
                </div>
            </div>

            {/* Live Logs Table with Interactive Column Sorting */}
            <div className="rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                    <table className="w-full text-left rtl:text-right">
                        <thead className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80">
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
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                            {sortedAndFilteredLogs.map((log, idx) => {
                                const isCheckIn = log.status === '0' || log.status === 0;
                                const isCheckOut = log.status === '1' || log.status === 1;

                                return (
                                    <tr key={log.id || `${log.pin}-${log.timestamp}-${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            <div className="font-semibold">{log.employees?.full_name || `Employee ${log.pin}`}</div>
                                            {log.employees?.department && (
                                                <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                                    {log.employees.department} {log.employees.branch ? `• ${log.employees.branch}` : ''}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 font-mono font-medium text-slate-600 dark:text-slate-300">
                                            {log.pin}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                                {formatPunchTime(log.timestamp)}
                                            </div>
                                            <div className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                                                {log.timestamp ? new Date(log.timestamp).toISOString().substring(0, 10) : '-'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                                isCheckIn 
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60' 
                                                    : isCheckOut 
                                                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60'
                                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                                            }`}>
                                                <span className={`h-1.5 w-1.5 rounded-full ${isCheckIn ? 'bg-emerald-500' : isCheckOut ? 'bg-blue-500' : 'bg-slate-400'}`}></span>
                                                <span>{isCheckIn ? t('status_checkin') : isCheckOut ? t('status_checkout') : `${t('status_other')} ${log.status}`}</span>
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                                            <div className="flex items-center gap-1.5 text-xs font-medium">
                                                {log.verify_mode === '1' || log.verify_mode === 1 ? (
                                                    <>
                                                        <Fingerprint size={14} className="text-blue-500" />
                                                        <span>{t('mode_fingerprint')}</span>
                                                    </>
                                                ) : log.verify_mode === '15' || log.verify_mode === 15 ? (
                                                    <>
                                                        <ScanFace size={14} className="text-purple-500" />
                                                        <span>{t('mode_face')}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <KeyRound size={14} className="text-amber-500" />
                                                        <span>{t('mode_card_pass')}</span>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {log.is_manual || !log.sn ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                                                    {t('source_manual')}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-600 dark:text-slate-400">
                                                    <MonitorSmartphone size={13} className="text-slate-400" />
                                                    <span>{log.sn}</span>
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedAndFilteredLogs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                                        <Activity size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-700 animate-pulse" />
                                        {t('live_no_punches')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
