'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Shift, Employee, EmployeeShift } from '@/types';
import { useLanguage } from '@/components/LanguageContext';
import { 
    Clock, 
    Users, 
    Moon, 
    Trash2,
} from 'lucide-react';

export default function ShiftsPage() {
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const supabase = useMemo(() => createClient(), []);
    const { t } = useLanguage();

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
            showToast(t('success'));
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
            showToast(t('success'));
            fetchData();
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to assign shift.', 'error');
        } finally {
            setIsAssigning(false);
        }
    };

    const removeShiftAssignment = async (pin: string) => {
        if (!confirm('Remove shift assignment for this employee?')) return;
        try {
            const { error } = await supabase.from('employee_shifts').delete().eq('pin', pin);
            if (error) throw error;
            showToast(t('success'));
            fetchData();
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Failed to remove assignment.', 'error');
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
                        {t('shifts_title')}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t('shifts_subtitle')}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                        {shifts.length} {t('nav_shifts')}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 1. Create Shift Template Form */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                        <Clock size={18} className="text-blue-500" />
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('shifts_create_title')}</h3>
                    </div>

                    <form onSubmit={createShift} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {t('shifts_name_label')}
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
                                    {t('shifts_start_label')}
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
                                    {t('shifts_end_label')}
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
                                <span>{t('shifts_overnight_badge')}</span>
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={isCreating}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl text-sm shadow-sm shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
                        >
                            {isCreating ? t('saving') : t('shifts_btn_create')}
                        </button>
                    </form>
                </div>

                {/* 2. Assign Shift to Employee Form */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
                        <Users size={18} className="text-indigo-500" />
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">{t('shifts_assign_title')}</h3>
                    </div>

                    <form onSubmit={assignShift} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                {t('shifts_select_emp')}
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
                                {t('shifts_select_shift')}
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
                            disabled={isAssigning}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl text-sm shadow-sm shadow-indigo-500/20 disabled:opacity-50 transition-all cursor-pointer"
                        >
                            {isAssigning ? t('saving') : t('shifts_btn_assign')}
                        </button>
                    </form>
                </div>

                {/* 3. Assigned Schedules Roster List */}
                <div className="p-6 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-col">
                    <h3 className="font-bold text-base text-slate-900 dark:text-white pb-2 border-b border-slate-100 dark:border-slate-800/60 mb-3">
                        {t('nav_shifts')} ({employeeShifts.length})
                    </h3>

                    <div className="flex-1 overflow-y-auto max-h-[380px] space-y-2 divide-y divide-slate-100 dark:divide-slate-800/60">
                        {employeeShifts.map((es, idx) => (
                            <div key={idx} className="pt-2 flex items-center justify-between text-xs">
                                <div>
                                    <div className="font-semibold text-slate-900 dark:text-white">
                                        {es.employees?.full_name || `PIN ${es.pin}`}
                                    </div>
                                    <div className="text-slate-400 font-mono">
                                        PIN: {es.pin} &bull; <span className="text-indigo-600 dark:text-indigo-400 font-medium">{es.shifts?.name}</span> ({es.shifts?.start_time?.substring(0,5) || '--:--'} - {es.shifts?.end_time?.substring(0,5) || '--:--'})
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeShiftAssignment(es.pin)}
                                    className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                                    title={t('delete')}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                        {employeeShifts.length === 0 && (
                            <div className="py-12 text-center text-slate-400 text-xs">
                                {t('no_reports_found')}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
