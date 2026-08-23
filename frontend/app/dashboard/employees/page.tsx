'use client';
import { useEffect, useState } from 'react';

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<any[]>([]);
    const [pin, setPin] = useState('');
    const [fullName, setFullName] = useState('');
    const [department, setDepartment] = useState('');
    const [designation, setDesignation] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');

    const fetchEmployees = async () => {
        try {
            const res = await fetch('/api/employees');
            const data = await res.json();
            setEmployees(Array.isArray(data) ? data : []);
        } catch (err) {
            setEmployees([]);
        }
    };

    useEffect(() => {
        fetchEmployees();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg('');
        setSuccessMsg('');
        
        try {
            const res = await fetch('/api/employees', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin, full_name: fullName, department, designation })
            });
            const data = await res.json();
            
            if (!res.ok) {
                setErrorMsg(data.error || 'Failed to save employee.');
            } else {
                setSuccessMsg('Employee saved successfully.');
                setPin('');
                setFullName('');
                setDepartment('');
                setDesignation('');
                fetchEmployees(); // Refresh list
            }
        } catch (err: any) {
            setErrorMsg(err.message || 'Error occurred.');
        }
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Employee Management</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Form Section */}
                <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h3 className="text-lg font-semibold mb-4">Add / Update Employee</h3>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Device PIN ID</label>
                            <input 
                                type="text" 
                                required 
                                value={pin} 
                                onChange={(e) => setPin(e.target.value)} 
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" 
                                placeholder="e.g. 101"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                            <input 
                                type="text" 
                                required 
                                value={fullName} 
                                onChange={(e) => setFullName(e.target.value)} 
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" 
                                placeholder="John Doe"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Department (Optional)</label>
                            <input 
                                type="text" 
                                value={department} 
                                onChange={(e) => setDepartment(e.target.value)} 
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" 
                                placeholder="e.g. Engineering"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Designation (Optional)</label>
                            <input 
                                type="text" 
                                value={designation} 
                                onChange={(e) => setDesignation(e.target.value)} 
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" 
                                placeholder="e.g. Software Engineer"
                            />
                        </div>
                        
                        {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
                        {successMsg && <p className="text-sm text-green-600">{successMsg}</p>}
                        
                        <button type="submit" className="w-full bg-blue-600 text-white font-semibold py-2 rounded-lg hover:bg-blue-700">
                            Save Employee
                        </button>
                    </form>
                </div>

                {/* List Section */}
                <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-4 text-sm font-medium text-gray-500">PIN</th>
                                <th className="px-6 py-4 text-sm font-medium text-gray-500">Name</th>
                                <th className="px-6 py-4 text-sm font-medium text-gray-500">Department</th>
                                <th className="px-6 py-4 text-sm font-medium text-gray-500">Designation</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {employees.map(emp => (
                                <tr key={emp.pin} className="hover:bg-gray-50 cursor-pointer" onClick={() => {
                                    setPin(emp.pin);
                                    setFullName(emp.full_name);
                                    setDepartment(emp.department || '');
                                    setDesignation(emp.designation || '');
                                }}>
                                    <td className="px-6 py-4 font-medium">{emp.pin}</td>
                                    <td className="px-6 py-4">{emp.full_name}</td>
                                    <td className="px-6 py-4 text-gray-500">{emp.department || '-'}</td>
                                    <td className="px-6 py-4 text-gray-500">{emp.designation || '-'}</td>
                                </tr>
                            ))}
                            {employees.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">No employees found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
