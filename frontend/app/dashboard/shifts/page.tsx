'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function ShiftsPage() {
    const [shifts, setShifts] = useState<any[]>([]);
    const [employees, setEmployees] = useState<any[]>([]);
    const [employeeShifts, setEmployeeShifts] = useState<any[]>([]);
    const supabase = createClient();

    // Form state
    const [newShiftName, setNewShiftName] = useState('');
    const [newShiftStart, setNewShiftStart] = useState('09:00');
    const [newShiftEnd, setNewShiftEnd] = useState('17:00');

    // Assign state
    const [assignEmpPin, setAssignEmpPin] = useState('');
    const [assignShiftId, setAssignShiftId] = useState('');

    const fetchData = async () => {
        const [{ data: sData }, { data: eData }, { data: esData }] = await Promise.all([
            supabase.from('shifts').select('*'),
            supabase.from('employees').select('*'),
            supabase.from('employee_shifts').select('*, shifts(name), employees(full_name)')
        ]);
        setShifts(sData || []);
        setEmployees(eData || []);
        setEmployeeShifts(esData || []);
        if (sData?.length) setAssignShiftId(sData[0].id);
        if (eData?.length) setAssignEmpPin(eData[0].pin);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const createShift = async (e: React.FormEvent) => {
        e.preventDefault();
        const { error } = await supabase.from('shifts').insert([{
            name: newShiftName,
            start_time: newShiftStart,
            end_time: newShiftEnd
        }]);
        if (error) alert(error.message);
        else {
            setNewShiftName('');
            fetchData();
        }
    };

    const assignShift = async (e: React.FormEvent) => {
        e.preventDefault();
        const { error } = await supabase.from('employee_shifts').upsert([{
            pin: assignEmpPin,
            shift_id: assignShiftId
        }], { onConflict: 'pin' });
        if (error) alert(error.message);
        else fetchData();
    };

    return (
        <div className="space-y-8">
            <h2 className="text-2xl font-bold">Shift Management</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Create Shift Form */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Create New Shift</h3>
                    <form onSubmit={createShift} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Shift Name</label>
                            <input required type="text" value={newShiftName} onChange={e => setNewShiftName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" placeholder="e.g. Morning Shift" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                                <input required type="time" value={newShiftStart} onChange={e => setNewShiftStart(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                                <input required type="time" value={newShiftEnd} onChange={e => setNewShiftEnd(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
                            </div>
                        </div>
                        <button type="submit" className="w-full bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700">Create Shift</button>
                    </form>
                </div>

                {/* Assign Shift Form */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Assign Shift to Employee</h3>
                    <form onSubmit={assignShift} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                            <select value={assignEmpPin} onChange={e => setAssignEmpPin(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white">
                                {employees.map(emp => (
                                    <option key={emp.pin} value={emp.pin}>{emp.full_name || emp.pin}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Shift</label>
                            <select value={assignShiftId} onChange={e => setAssignShiftId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white">
                                {shifts.map(shift => (
                                    <option key={shift.id} value={shift.id}>{shift.name} ({shift.start_time} - {shift.end_time})</option>
                                ))}
                            </select>
                        </div>
                        <button type="submit" className="w-full bg-green-600 text-white rounded-lg px-4 py-2 hover:bg-green-700">Assign Shift</button>
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
                            <tr key={idx}>
                                <td className="px-6 py-4 font-medium">{es.employees?.full_name || es.pin}</td>
                                <td className="px-6 py-4 text-blue-600 font-medium">{es.shifts?.name}</td>
                                <td className="px-6 py-4 text-gray-500">
                                    {es.shifts?.start_time?.substring(0,5)} to {es.shifts?.end_time?.substring(0,5)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
