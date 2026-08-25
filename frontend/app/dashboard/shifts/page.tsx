'use client';
import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Shift, Employee, EmployeeShift } from '@/types';

export default function ShiftsPage() {
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [employeeShifts, setEmployeeShifts] = useState<EmployeeShift[]>([]);
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const supabase = createClient();

    // Form state
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
                supabase.from('employee_shifts').select('*, shifts(name, start_time, end_time), employees(full_name)')
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

    const createShift = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        try {
            const { error } = await supabase.from('shifts').insert([{
                name: newShiftName,
                start_time: newShiftStart,
                end_time: newShiftEnd
            }]);
            if (error) throw error;
            showToast('Shift created successfully.');
            setNewShiftName('');
            fetchData();
        } catch (err: any) {
            showToast(err.message || 'Failed to create shift.', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const assignShift = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignEmpPin || !assignShiftId) {
            showToast('Please select both an employee and a shift.', 'error');
            return;
        }
        setIsAssigning(true);
        try {
            const { error } = await supabase.from('employee_shifts').upsert([{
                pin: assignEmpPin,
                shift_id: assignShiftId
            }], { onConflict: 'pin' });
            if (error) throw error;
            showToast('Shift assigned successfully.');
            fetchData();
        } catch (err: any) {
            showToast(err.message || 'Failed to assign shift.', 'error');
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <div className="space-y-8">
            {toastMsg && (
                <div className={`p-4 rounded-lg border text-sm font-medium ${
                    toastMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                    {toastMsg.text}
                </div>
            )}

            <h2 className="text-2xl font-bold">Shift Management</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Create Shift Form */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Create New Shift</h3>
                    <form onSubmit={createShift} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Shift Name</label>
                            <input 
                                required 
                                type="text" 
                                value={newShiftName} 
                                onChange={e => setNewShiftName(e.target.value)} 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" 
                                placeholder="e.g. Morning Shift" 
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                                <input 
                                    required 
                                    type="time" 
                                    value={newShiftStart} 
                                    onChange={e => setNewShiftStart(e.target.value)} 
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" 
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                                <input 
                                    required 
                                    type="time" 
                                    value={newShiftEnd} 
                                    onChange={e => setNewShiftEnd(e.target.value)} 
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" 
                                />
                            </div>
                        </div>
                        <button 
                            type="submit" 
                            disabled={isCreating}
                            className="w-full bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50 text-sm font-semibold cursor-pointer transition-colors"
                        >
                            {isCreating ? 'Creating...' : 'Create Shift'}
                        </button>
                    </form>
                </div>

                {/* Assign Shift Form */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Assign Shift to Employee</h3>
                    <form onSubmit={assignShift} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                            <select 
                                value={assignEmpPin} 
                                onChange={e => setAssignEmpPin(e.target.value)} 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-sm focus:ring-2 focus:ring-blue-500"
                            >
                                {employees.map(emp => (
                                    <option key={emp.pin} value={emp.pin}>{emp.full_name || emp.pin}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
                            <select 
                                value={assignShiftId} 
                                onChange={e => setAssignShiftId(e.target.value)} 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white text-sm focus:ring-2 focus:ring-blue-500"
                            >
                                {shifts.map(shift => (
                                    <option key={shift.id} value={shift.id}>{shift.name} ({shift.start_time.substring(0,5)} - {shift.end_time.substring(0,5)})</option>
                                ))}
                            </select>
                        </div>
                        <button 
                            type="submit" 
                            disabled={isAssigning}
                            className="w-full bg-green-600 text-white rounded-lg px-4 py-2 hover:bg-green-700 disabled:opacity-50 text-sm font-semibold cursor-pointer transition-colors"
                        >
                            {isAssigning ? 'Assigning...' : 'Assign Shift'}
                        </button>
                    </form>
                </div>
            </div>

            {/* Existing Assignments Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-8">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Employee</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Assigned Shift</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Schedule</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {employeeShifts.map((es, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-6 py-4 font-medium text-sm">{es.employees?.full_name || es.pin}</td>
                                <td className="px-6 py-4 text-blue-600 font-medium text-sm">{es.shifts?.name || '-'}</td>
                                <td className="px-6 py-4 text-gray-500 text-sm font-mono">
                                    {es.shifts?.start_time ? `${es.shifts.start_time.substring(0,5)} to ${es.shifts.end_time?.substring(0,5)}` : '-'}
                                </td>
                            </tr>
                        ))}
                        {employeeShifts.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-6 py-8 text-center text-gray-500 text-sm">No shift assignments yet.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
