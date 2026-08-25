'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AttendanceLog } from '@/types';
import { formatPunchTime } from '@/lib/utils/formatTime';
import { 
    Activity, 
    RotateCw, 
    Search, 
    Fingerprint, 
    ScanFace, 
    KeyRound, 
    MonitorSmartphone,
    Radio
} from 'lucide-react';

export default function LiveMonitor() {
    const [logs, setLogs] = useState<AttendanceLog[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const supabase = useMemo(() => createClient(), []);

    const fetchLogs = useCallback(async (isManualTrigger = false) => {
        if (isManualTrigger) setIsRefreshing(true);
        try {
            const { data, error } = await supabase
                .from('attendance_logs')
                .select('*, employees(full_name, branch, department)')
                .order('timestamp', { ascending: false })
                .limit(40);
            
            if (!error && data) {
                setLogs(data as AttendanceLog[]);
                setLastUpdated(new Date());
            }
        } catch (err: unknown) {
            console.error('Error fetching live logs:', err);
        } finally {
            if (isManualTrigger) {
                setTimeout(() => setIsRefreshing(false), 500);
            }
        }
    }, [supabase]);

    useEffect(() => {
        // 1. Initial fetch
        fetchLogs();

        // 2. Continuous 4-second Polling Fallback (ensures live feed even if WebSockets are blocked)
        const pollInterval = setInterval(() => {
            fetchLogs();
        }, 4000);

        // 3. Supabase Realtime WebSocket Listener (instantaneous updates)
        const channel = supabase
            .channel('realtime_live_logs')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
                async (payload) => {
                    const newLog = payload.new as AttendanceLog;
                    // Fetch employee metadata
                    const { data: empData } = await supabase
                        .from('employees')
                        .select('full_name, branch, department')
                        .eq('pin', newLog.pin)
                        .maybeSingle();

                    setLogs((prev) => {
                        const exists = prev.some(l => l.id === newLog.id || (l.pin === newLog.pin && l.timestamp === newLog.timestamp));
                        if (exists) return prev;
                        return [{ ...newLog, employees: empData }, ...prev].slice(0, 40);
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

    const filteredLogs = logs.filter(log => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        const empName = log.employees?.full_name?.toLowerCase() || '';
        const pin = String(log.pin).toLowerCase();
        const sn = (log.sn || '').toLowerCase();
        return empName.includes(term) || pin.includes(term) || sn.includes(term);
    });

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                            Live Attendance Monitor
                        </h2>
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <span>Live Streaming &bull; 4s Polling</span>
                        </span>
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Real-time biometric terminal scan feed. Last updated at {lastUpdated.toLocaleTimeString()}.
                    </p>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    {/* Search Input */}
                    <div className="relative flex-1 sm:w-64">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Filter by name, PIN, or SN..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-2xs"
                        />
                    </div>

                    {/* Manual Refresh Button */}
                    <button
                        type="button"
                        onClick={() => fetchLogs(true)}
                        disabled={isRefreshing}
                        title="Force Refresh"
                        className="p-2 rounded-xl bg-white dark:bg-[#0c121e] hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                        <RotateCw size={18} className={isRefreshing ? 'animate-spin text-blue-500' : ''} />
                    </button>
                </div>
            </div>

            {/* Live Logs Table */}
            <div className="rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80">
                            <tr>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Employee</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">PIN ID</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Timestamp (UTC)</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Verify Mode</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Source / Device</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                            {filteredLogs.map((log, idx) => {
                                const isCheckIn = log.status === '0' || log.status === 0;
                                const isCheckOut = log.status === '1' || log.status === 1;

                                return (
                                    <tr key={log.id || `${log.pin}-${log.timestamp}-${idx}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            <div className="font-semibold">{log.employees?.full_name || `Employee ${log.pin}`}</div>
                                            {log.employees?.department && (
                                                <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                                    {log.employees.department} {log.employees.branch ? `&bull; ${log.employees.branch}` : ''}
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
                                                <span>{isCheckIn ? 'Check-In' : isCheckOut ? 'Check-Out' : `Status ${log.status}`}</span>
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                                            <div className="flex items-center gap-1.5 text-xs font-medium">
                                                {log.verify_mode === '1' || log.verify_mode === 1 ? (
                                                    <>
                                                        <Fingerprint size={14} className="text-blue-500" />
                                                        <span>Fingerprint</span>
                                                    </>
                                                ) : log.verify_mode === '15' || log.verify_mode === 15 ? (
                                                    <>
                                                        <ScanFace size={14} className="text-purple-500" />
                                                        <span>Face Recognition</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <KeyRound size={14} className="text-amber-500" />
                                                        <span>Password / Badge</span>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {log.is_manual || log.sn === 'MANUAL_ENTRY' ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
                                                    Manual Punch
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-600 dark:text-slate-400">
                                                    <MonitorSmartphone size={13} className="text-slate-400" />
                                                    <span>{log.sn || 'ADMS'}</span>
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {filteredLogs.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                                        <Activity size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-700 animate-pulse" />
                                        No recent punches found. Waiting for terminal activity...
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
