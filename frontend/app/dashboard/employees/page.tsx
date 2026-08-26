'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { Employee } from '@/types';
import { 
    Users, 
    Plus, 
    Search, 
    Edit, 
    Trash2, 
    Building2, 
    Briefcase, 
    X,
    UserCheck,
    AlertCircle
} from 'lucide-react';

export default function EmployeesPage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [branchFilter, setBranchFilter] = useState('all');
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Modal state for Add/Edit
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [pin, setPin] = useState('');
    const [fullName, setFullName] = useState('');
    const [department, setDepartment] = useState('');
    const [branch, setBranch] = useState('');
    const [designation, setDesignation] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToastMsg({ text, type });
        setTimeout(() => setToastMsg(null), 4000);
    };

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await fetch('/api/employees');
            if (res.ok) {
                const data = await res.json();
                setEmployees(Array.isArray(data) ? data : []);
            } else {
                showToast('Failed to fetch employees list', 'error');
                setEmployees([]);
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error fetching employees', 'error');
            setEmployees([]);
        }
    }, []);

    useEffect(() => {
        fetchEmployees();
    }, [fetchEmployees]);

    const openAddModal = () => {
        setEditingEmployee(null);
        setPin('');
        setFullName('');
        setDepartment('');
        setBranch('');
        setDesignation('');
        setIsModalOpen(true);
    };

    const openEditModal = (emp: Employee) => {
        setEditingEmployee(emp);
        setPin(emp.pin);
        setFullName(emp.full_name);
        setDepartment(emp.department || '');
        setBranch(emp.branch || '');
        setDesignation(emp.designation || '');
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        
        try {
            const res = await fetch('/api/employees', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    pin, 
                    full_name: fullName, 
                    department, 
                    branch, 
                    designation 
                })
            });
            const data = await res.json();
            
            if (!res.ok) {
                showToast(data.error || 'Failed to save employee profile.', 'error');
            } else {
                showToast(editingEmployee ? 'Employee updated successfully.' : 'New employee registered successfully.');
                setIsModalOpen(false);
                fetchEmployees();
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error saving employee.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const branches = useMemo(() => {
        const set = new Set(employees.map(e => e.branch).filter(Boolean));
        return Array.from(set) as string[];
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        return employees.filter(emp => {
            if (branchFilter !== 'all' && emp.branch !== branchFilter) return false;
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return (
                emp.full_name.toLowerCase().includes(term) ||
                emp.pin.toLowerCase().includes(term) ||
                (emp.department && emp.department.toLowerCase().includes(term)) ||
                (emp.designation && emp.designation.toLowerCase().includes(term))
            );
        });
    }, [employees, branchFilter, searchTerm]);

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

            {/* Header Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Employee Management
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Manage biometric PIN IDs, department assignments, and branch locations.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={openAddModal}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
                >
                    <Plus size={16} />
                    <span>Add Employee</span>
                </button>
            </div>

            {/* Filters Row */}
            <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="relative flex-1 w-full">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by name, PIN, department, or title..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                    />
                </div>

                <select
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="w-full sm:w-56 px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs cursor-pointer"
                >
                    <option value="all">All Branches ({employees.length})</option>
                    {branches.map(b => (
                        <option key={b} value={b}>{b}</option>
                    ))}
                </select>
            </div>

            {/* Employee Table */}
            <div className="rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80">
                            <tr>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">PIN ID</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Full Name</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Department</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Branch</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Designation</th>
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                            {filteredEmployees.map(emp => (
                                <tr key={emp.pin} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors">
                                    <td className="px-6 py-4 font-mono font-bold text-slate-700 dark:text-slate-300">
                                        {emp.pin}
                                    </td>
                                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">
                                        {emp.full_name}
                                    </td>
                                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                                        {emp.department ? (
                                            <span className="inline-flex items-center gap-1 text-xs">
                                                <Building2 size={13} className="text-slate-400" />
                                                <span>{emp.department}</span>
                                            </span>
                                        ) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-blue-600 dark:text-blue-400 font-medium">
                                        {emp.branch ? (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/50">
                                                {emp.branch}
                                            </span>
                                        ) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400 text-xs">
                                        {emp.designation || '-'}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            type="button"
                                            onClick={() => openEditModal(emp)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 text-xs font-semibold border border-slate-200 dark:border-slate-700/80 transition-colors cursor-pointer"
                                        >
                                            <Edit size={13} />
                                            <span>Edit</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filteredEmployees.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500 text-sm">
                                        <Users size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-700" />
                                        No employees found matching current search/filter.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add / Edit Employee Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-[#0c121e] rounded-2xl p-4 sm:p-6 max-w-lg w-full shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 sm:space-y-5 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {editingEmployee ? 'Edit Employee Profile' : 'Register New Employee'}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {editingEmployee ? `Update details for PIN ${editingEmployee.pin}` : 'Assign PIN ID matching your ZKTeco physical terminal'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Terminal PIN ID <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={pin}
                                        onChange={(e) => setPin(e.target.value)}
                                        disabled={!!editingEmployee}
                                        placeholder="e.g. 101"
                                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Full Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        placeholder="John Doe"
                                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Department (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={department}
                                        onChange={(e) => setDepartment(e.target.value)}
                                        placeholder="e.g. Engineering"
                                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Branch Location (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={branch}
                                        onChange={(e) => setBranch(e.target.value)}
                                        placeholder="e.g. Riyadh HQ"
                                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                    Job Designation (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={designation}
                                    onChange={(e) => setDesignation(e.target.value)}
                                    placeholder="e.g. Senior Software Engineer"
                                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800/80">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
                                >
                                    {isSaving ? 'Saving...' : editingEmployee ? 'Save Changes' : 'Create Employee'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
