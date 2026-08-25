'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AttendanceLog } from '@/types';

export default function LiveMonitor() {
    const [logs, setLogs] = useState<AttendanceLog[]>([]);
    const supabase = createClient();

    useEffect(() => {
        // Fetch initial logs
        const fetchLogs = async () => {
            const { data } = await supabase
                .from('attendance_logs')
                .select('*, employees(full_name)')
                .order('timestamp', { ascending: false })
                .limit(25);
            if (data) setLogs(data as AttendanceLog[]);
        };
        fetchLogs();

        // Subscribe to real-time changes
        const channel = supabase
            .channel('realtime_logs')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_logs' }, async (payload) => {
                const newLog = payload.new as AttendanceLog;
                // Fetch employee details
                const { data: empData } = await supabase
                    .from('employees')
                    .select('full_name')
                    .eq('pin', newLog.pin)
                    .single();

                setLogs((prev) => [{ ...newLog, employees: empData }, ...prev].slice(0, 25));
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [supabase]);

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Live Attendance Monitor</h2>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Employee</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">PIN</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Time</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Status</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Verify Mode</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Device</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {logs.map((log, idx) => (
                            <tr key={log.id || idx} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 text-sm font-medium">{log.employees?.full_name || 'Unknown'}</td>
                                <td className="px-6 py-4 text-sm text-gray-600">{log.pin}</td>
                                <td className="px-6 py-4 text-sm text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                                <td className="px-6 py-4 text-sm">
                                    <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                                        log.status === '0' || log.status === 0 ? 'bg-green-100 text-green-700' : 
                                        log.status === '1' || log.status === 1 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                                    }`}>
                                        {log.status === '0' || log.status === 0 ? 'Check-In' : 
                                         log.status === '1' || log.status === 1 ? 'Check-Out' : 'Punch'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500">
                                    {log.verify_mode === '1' || log.verify_mode === 1 ? 'Fingerprint' : 
                                     log.verify_mode === '15' || log.verify_mode === 15 ? 'Face' : 'Password/Other'}
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-500 font-mono text-xs">
                                    {log.sn || '-'}
                                </td>
                            </tr>
                        ))}
                        {logs.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-gray-500 text-sm">No recent punches detected.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
