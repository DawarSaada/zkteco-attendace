'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Shift, Employee, EmployeeShift } from '@/types';
import { 
    Clock, 
    Plus, 
    Users, 
    Calendar, 
    Moon, 
    Sun, 
    Check, 
    Trash2,
    Briefcase
} from 'lucide-react';

export default function ShiftsPage() {
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const supabase = useMemo(() => createClient(), []);

    // Create Shift State
    const [newShiftName, setNewShiftName] = useState('');
    const [newShiftStart, setNewShiftStart] = useState('09:00');
    const [newShiftEnd, setNewShiftEnd] = useState('17:00');
    const [isCreating, setIsCreating] = useState(false);

    // Assign state
    const [assignEmpPin, setAssignEmpPin] = useState('');
    const [assignShiftId, setAssignShiftId] = useState('');
    const [isAssigning, setIsAssigning] = useState(false);

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToastMsg({ text, type });
        setTimeout(() => setToastMsg(null), 4000);
    };

    const fetchData = useCallback(async () => {
        try {
            const [{ data: sData, error: sErr }, { data: eData, error: eErr }, { data: esData, error: esErr }] = await Promise.all([
                supabase.from('shifts').select('*').order('name'),
                supabase.from('employees').select('*').order('full_name'),
                supabase.from('employee_shifts').select('*, shifts(name, start_time, end_time), employees(full_name, branch, department)')
            ]);

            if (sErr) throw sErr;
            if (eErr) throw eErr;
            if (esErr) throw esErr;

            setShifts(sData || []);
            setEmployees(eData || []);
            setEmployeeShifts(esData || []);
            if (sData?.length && !assignShiftId) setAssignShiftId(sData[0].id);
            if (eData?.length && !assignEmpPin) setAssignEmpPin(eData[0].pin);
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to fetch shift data.', 'error');
        }
    }, [supabase, assignShiftId, assignEmpPin]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const isOvernight = useMemo(() => {
        return newShiftEnd < newShiftStart;
    }, [newShiftStart, newShiftEnd]);

    const createShift = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        try {
            const { data, error } = await supabase
                .from('shifts')
                .insert([{ 
                    name: newShiftName, 
                    start_time: newShiftStart, 
                    end_time: newShiftEnd 
                }])
                .select();
                
            if (error) throw error;
            showToast('Shift template created successfully.');
            setNewShiftName('');
            fetchData();
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to create shift.', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const assignShift = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignEmpPin || !assignShiftId) return;
        setIsAssigning(true);
        try {
            const { error } = await supabase
                .from('employee_shifts')
                .upsert({ pin: assignEmpPin, shift_id: assignShiftId }, { onConflict: 'pin' });
                
            if (error) throw error;
            showToast('Shift schedule assigned to employee.');
            fetchData();
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to assign shift.', 'error');
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-200">
            {/* Toast Notification */}
            {toastMsg && (
                <div className={`p-4 rounded-xl border text-sm font-medium transition-all ${
                    toastMsg.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                }`}>
                    {toastMsg.text}
                </div>
            )}

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Shifts & Work Schedules
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Define standard and overnight shift hours, and map them to employee timecards.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                        {shifts.length} Active Templates
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1. Create Shift Template Form */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                        <Clock size={18} className="text-blue-500" />
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">Create Shift Schedule</h3>
                    </div>

                    <form onSubmit={createShift} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                Shift Name
                            </label>
                            <input 
                                type="text" 
                                required
                                value={newShiftName}
                                onChange={e => setNewShiftName(e.target.value)}
                                placeholder="e.g. Standard Morning / Night Shift"
                                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    Start Time
                                </label>
                                <input 
                                    type="time" 
                                    required
                                    value={newShiftStart}
                                    onChange={e => setNewShiftStart(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    End Time
                                </label>
                                <input 
                                    type="time" 
                                    required
                                    value={newShiftEnd}
                                    onChange={e => setNewShiftEnd(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        {/* Overnight Indicator */}
                        {isOvernight && (
                            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                                <Moon size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                <span><strong>Overnight Shift:</strong> End time crosses past midnight into the next calendar day.</span>
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={isCreating}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm shadow-sm shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
                        >
                            {isCreating ? 'Creating Template...' : 'Save Shift Template'}
                        </button>
                    </form>
                </div>

                {/* 2. Assign Shift to Employee Form */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                        <Users size={18} className="text-indigo-500" />
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">Assign Shift Schedule</h3>
                    </div>

                    <form onSubmit={assignShift} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                Select Employee
                            </label>
                            <select 
                                value={assignEmpPin}
                                onChange={e => setAssignEmpPin(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                            >
                                {employees.map(emp => (
                                    <option key={emp.pin} value={emp.pin}>
                                        {emp.full_name} ({emp.pin}) {emp.branch ? `- ${emp.branch}` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                Select Shift Template
                            </label>
                            <select 
                                value={assignShiftId}
                                onChange={e => setAssignShiftId(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                            >
                                {shifts.map(shift => (
                                    <option key={shift.id} value={shift.id}>
                                        {shift.name} ({shift.start_time.substring(0,5)} - {shift.end_time.substring(0,5)})
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button 
                            type="submit" 
                            disabled={isAssigning || shifts.length === 0 || employees.length === 0}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl text-sm shadow-sm shadow-indigo-500/20 disabled:opacity-50 transition-all cursor-pointer"
                        >
                            {isAssigning ? 'Assigning...' : 'Assign Schedule'}
                        </button>
                    </form>
                </div>

                {/* 3. Existing Shift Templates List */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                        <Calendar size={18} className="text-emerald-500" />
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">Active Shift Templates</h3>
                    </div>

                    <div className="space-y-2.5 max-h-60 overflow-y-auto">
                        {shifts.map(shift => {
                            const isOver = shift.end_time < shift.start_time;
                            return (
                                <div key={shift.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800/60 flex items-center justify-between">
                                    <div>
                                        <h4 className="font-semibold text-xs text-slate-900 dark:text-white">{shift.name}</h4>
                                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            <span>{shift.start_time.substring(0,5)} - {shift.end_time.substring(0,5)}</span>
                                            {isOver && (
                                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-sans font-semibold px-1 rounded bg-amber-50 dark:bg-amber-950/60">
                                                    Overnight
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                        {shifts.length === 0 && (
                            <p className="text-xs text-slate-400 text-center py-4">No shift templates created yet.</p>
                        )}
                    </div>
                </div>
            </div>

            {/* 4. Employee Shift Assignments Table */}
            <div className="rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden transition-colors">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800/80">
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">Current Employee Shift Assignments</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80">
                            <tr>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">PIN ID</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Employee Name</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Assigned Shift</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Schedule Hours</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                            {employeeShifts.map(es => (
                                <tr key={es.pin} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors">
                                    <td className="px-6 py-4 font-mono font-bold text-slate-700 dark:text-slate-300">
                                        {es.pin}
                                    </td>
                                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">
                                        {es.employees?.full_name || `User ${es.pin}`}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                                            {es.shifts?.name || 'Assigned Shift'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                                        {es.shifts?.start_time && es.shifts?.end_time 
                                            ? `${es.shifts.start_time.substring(0,5)} - ${es.shifts.end_time.substring(0,5)}` 
                                            : '-'}
                                    </td>
                                </tr>
                            ))}
                            {employeeShifts.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                                        No employee shift assignments configured yet.
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
