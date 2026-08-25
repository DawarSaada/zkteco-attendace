'use client';
import { useEffect, useState } from 'react';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Employee, DailyAttendanceSummary, RawPunch } from '@/types';

export default function ReportsPage() {
    const [rangeType, setRangeType] = useState('daily');
    const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [employeesList, setEmployeesList] = useState<Employee[]>([]);
    const [filterPin, setFilterPin] = useState('all');
    const [filterBranch, setFilterBranch] = useState('all');
    const [loading, setLoading] = useState(false);
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Punches Modal State
    const [selectedRowForPunches, setSelectedRowForPunches] = useState<{ pin: string; date: string; name: string } | null>(null);
    const [rawPunches, setRawPunches] = useState<RawPunch[]>([]);
    const [newPunchTime, setNewPunchTime] = useState('09:00');
    const [isSavingPunch, setIsSavingPunch] = useState(false);

    const [reports, setReports] = useState<DailyAttendanceSummary[]>([]);
    const [errorMsg, setErrorMsg] = useState('');

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToastMsg({ text, type });
        setTimeout(() => setToastMsg(null), 4000);
    };

    // 1. Fetch employees list on mount to activate dropdown filters
    useEffect(() => {
        const fetchEmployees = async () => {
            try {
                const res = await fetch('/api/employees');
                if (res.ok) {
                    const data = await res.json();
                    setEmployeesList(Array.isArray(data) ? data : []);
                } else {
                    console.error('Failed to fetch employee list for filters');
                }
            } catch (err) {
                console.error('Error fetching employees:', err);
            }
        };
        fetchEmployees();
    }, []);

    // 2. Adjust dates when range type changes
    useEffect(() => {
        const today = new Date();
        if (rangeType === 'daily') {
            const todayStr = format(today, 'yyyy-MM-dd');
            setStartDate(todayStr);
            setEndDate(todayStr);
        } else if (rangeType === 'weekly') {
            setStartDate(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
            setEndDate(format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
        } else if (rangeType === 'monthly') {
            setStartDate(format(startOfMonth(today), 'yyyy-MM-dd'));
            setEndDate(format(endOfMonth(today), 'yyyy-MM-dd'));
        }
    }, [rangeType]);

    // 3. Fetch attendance reports
    const fetchReports = async () => {
        setLoading(true);
        setErrorMsg('');
        try {
            const res = await fetch(`/api/reports/daily?start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`);
            const data = await res.json();
            if (res.ok) {
                setReports(Array.isArray(data) ? data : []);
            } else {
                setReports([]);
                setErrorMsg(data.error || 'Failed to fetch reports.');
            }
        } catch (err: any) {
            setReports([]);
            setErrorMsg(err.message || 'Error occurred while fetching data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, [startDate, endDate, filterPin, filterBranch]);

    // 4. Punches Modal Handlers
    const openPunchesModal = async (pin: string, date: string, name: string) => {
        setSelectedRowForPunches({ pin, date, name });
        fetchRawPunches(pin, date);
    };

    const fetchRawPunches = async (pin: string, date: string) => {
        try {
            const res = await fetch(`/api/attendance/manual?pin=${pin}&date=${date}`);
            const data = await res.json();
            if (res.ok) {
                setRawPunches(Array.isArray(data) ? data : []);
            } else {
                showToast(data.error || 'Failed to load punches', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Error loading punches', 'error');
        }
    };

    const deletePunch = async (timestamp: string) => {
        if (!selectedRowForPunches) return;
        if (!confirm('Are you sure you want to delete this punch record?')) return;
        
        try {
            const res = await fetch('/api/attendance/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete', pin: selectedRowForPunches.pin, timestamp })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Punch deleted successfully.');
                fetchRawPunches(selectedRowForPunches.pin, selectedRowForPunches.date);
                fetchReports();
            } else {
                showToast(data.error || 'Failed to delete punch.', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Error deleting punch.', 'error');
        }
    };

    const addManualPunch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRowForPunches) return;
        setIsSavingPunch(true);

        try {
            const localDateTimeStr = `${selectedRowForPunches.date}T${newPunchTime}:00`;
            const timestamp = new Date(localDateTimeStr).toISOString();

            const res = await fetch('/api/attendance/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', pin: selectedRowForPunches.pin, timestamp })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Manual punch added successfully.');
                fetchRawPunches(selectedRowForPunches.pin, selectedRowForPunches.date);
                fetchReports();
            } else {
                showToast(data.error || 'Failed to add manual punch.', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Error adding punch.', 'error');
        } finally {
            setIsSavingPunch(false);
        }
    };

    // 5. Excel Export Handler
    const handleExportExcel = () => {
        window.location.href = `/api/reports/export?start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`;
    };

    // 6. Direct Client-side PDF Generation from memory (No broken binary fetch)
    const handleExportPDF = () => {
        if (reports.length === 0) {
            showToast('No attendance records available to generate PDF.', 'error');
            return;
        }

        const doc = new jsPDF('landscape');

        // Group attendance summary records by employee PIN
        const groupedReports = reports.reduce((acc, row) => {
            const empKey = row.pin;
            if (!acc[empKey]) {
                acc[empKey] = {
                    pin: row.pin,
                    name: row.full_name || row.pin,
                    department: row.department || '',
                    branch: row.branch || '',
                    records: []
                };
            }
            acc[empKey].records.push(row);
            return acc;
        }, {} as Record<string, { pin: string; name: string; department: string; branch: string; records: DailyAttendanceSummary[] }>);

        const employees = Object.values(groupedReports);

        employees.forEach((emp, index) => {
            if (index > 0) {
                doc.addPage();
            }

            doc.setFontSize(11);
            doc.text(`Start Date: ${startDate}    End Date: ${endDate}`, 14, 15);
            const deptString = emp.department ? `, Department: ${emp.department}` : '';
            const branchString = emp.branch ? `, Branch: ${emp.branch}` : '';
            doc.text(`Employee ID: ${emp.pin}, Name: ${emp.name}${deptString}${branchString}`, 14, 22);

            const tableColumn = [
                "Date", "Weekday", "Timetable", "Check In", "Check Out", 
                "Normal", "Break", "Work day", "Clock In", "Clock Out", 
                "Total Hours", "Work Hours", "Break Out", "Break In"
            ];
            
            let totalMinutesAll = 0;

            const tableRows = emp.records.map((row) => {
                const pDate = new Date(row.punch_date);
                const weekday = format(pDate, 'EEEE');
                
                let clockIn = '';
                let clockOut = '';
                let totalHours = '';

                if (row.check_in) {
                    clockIn = format(new Date(row.check_in), 'HH:mm');
                }
                
                if (row.check_out && row.check_in && row.check_in !== row.check_out) {
                    clockOut = format(new Date(row.check_out), 'HH:mm');
                    const cIn = new Date(row.check_in).getTime();
                    const cOut = new Date(row.check_out).getTime();
                    const mins = Math.floor((cOut - cIn) / 60000);
                    
                    if (mins > 0) {
                        totalMinutesAll += mins;
                        const hrs = Math.floor(mins / 60);
                        const remainingMins = mins % 60;
                        totalHours = `${hrs.toString().padStart(2, '0')}:${remainingMins.toString().padStart(2, '0')}`;
                    }
                }

                return [
                    row.punch_date,
                    weekday,
                    '', // Timetable
                    row.shift_start ? row.shift_start.substring(0, 5) : '00:00',
                    row.shift_end ? row.shift_end.substring(0, 5) : '00:00',
                    '', '', // Normal, Break
                    '1.0', // Work day
                    clockIn,
                    clockOut,
                    totalHours,
                    '12:00', // Work Hours standard placeholder
                    '', '' // Break Out, Break In
                ];
            });

            // Statistics Row at bottom of table
            const totalHrs = Math.floor(totalMinutesAll / 60);
            const totalMins = totalMinutesAll % 60;
            const formattedTotal = `${totalHrs.toString().padStart(2, '0')}:${totalMins.toString().padStart(2, '0')}`;
            
            tableRows.push([
                'Statistics', '', '', '', '', '', '', '', '', '', formattedTotal, '', '', ''
            ]);

            autoTable(doc, {
                head: [tableColumn],
                body: tableRows,
                startY: 28,
                theme: 'grid',
                styles: { 
                    fontSize: 8,
                    lineColor: [0, 0, 0],
                    lineWidth: 0.1,
                    textColor: [0, 0, 0]
                },
                headStyles: { 
                    fillColor: [245, 245, 245], 
                    textColor: [0, 0, 0],
                    fontStyle: 'bold'
                }
            });
        });

        doc.save(`TimeCards_${startDate}_to_${endDate}.pdf`);
        showToast('PDF exported successfully!');
    };

    // Calculate unique branch list from loaded employees
    const uniqueBranches = Array.from(new Set(employeesList.map(e => e.branch).filter(Boolean))) as string[];

    return (
        <div className="space-y-6">
            {/* Toast Notification */}
            {toastMsg && (
                <div className={`p-4 rounded-lg border text-sm font-medium transition-all ${
                    toastMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                    {toastMsg.text}
                </div>
            )}

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-2xl font-bold">Attendance Report</h2>
                <div className="flex flex-wrap gap-4 items-center">
                    {/* Branch Filter */}
                    <select 
                        value={filterBranch} 
                        onChange={(e) => setFilterBranch(e.target.value)}
                        className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                        <option value="all">All Branches</option>
                        {uniqueBranches.map(branch => (
                            <option key={branch} value={branch}>{branch}</option>
                        ))}
                    </select>

                    {/* Employee Filter */}
                    <select 
                        value={filterPin} 
                        onChange={(e) => setFilterPin(e.target.value)}
                        className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                        <option value="all">All Employees</option>
                        {employeesList
                            .filter(e => filterBranch === 'all' || e.branch === filterBranch)
                            .map(emp => (
                                <option key={emp.pin} value={emp.pin}>{emp.full_name || emp.pin}</option>
                            ))}
                    </select>

                    {/* Range Type */}
                    <select 
                        value={rangeType} 
                        onChange={(e) => setRangeType(e.target.value)}
                        className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                        <option value="daily">Daily</option>
                        <option value="weekly">This Week</option>
                        <option value="monthly">This Month</option>
                        <option value="custom">Custom Range</option>
                    </select>

                    {rangeType === 'custom' && (
                        <div className="flex items-center space-x-2 text-sm">
                            <input 
                                type="date" 
                                value={startDate} 
                                onChange={(e) => setStartDate(e.target.value)} 
                                className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <span>to</span>
                            <input 
                                type="date" 
                                value={endDate} 
                                onChange={(e) => setEndDate(e.target.value)} 
                                className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    )}
                    
                    <button 
                        onClick={handleExportExcel}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-medium transition-colors cursor-pointer"
                    >
                        Export Excel
                    </button>
                    <button 
                        onClick={handleExportPDF}
                        className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 text-sm font-medium transition-colors cursor-pointer"
                    >
                        Export PDF
                    </button>
                </div>
            </div>

            {errorMsg && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-200">
                    {errorMsg}
                </div>
            )}

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Employee</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Date</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Scheduled Shift</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Check In</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Check Out</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Total Hours</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {reports.map((row, idx) => {
                            let totalHours = '-';
                            if (row.check_in && row.check_out && row.check_in !== row.check_out) {
                                const mins = Math.floor((new Date(row.check_out).getTime() - new Date(row.check_in).getTime()) / 60000);
                                if (mins > 0) {
                                    totalHours = `${Math.floor(mins / 60)}h ${mins % 60}m`;
                                }
                            }
                            
                            const shiftStr = (row.shift_start && row.shift_end) 
                                ? `${row.shift_start.substring(0,5)} - ${row.shift_end.substring(0,5)}` 
                                : 'No Shift';

                            return (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 font-medium">
                                        <div>{row.full_name || row.pin}</div>
                                        {row.branch && <div className="text-xs text-gray-400">Branch: {row.branch}</div>}
                                    </td>
                                    <td className="px-6 py-4 text-gray-500">{row.punch_date}</td>
                                    <td className="px-6 py-4 text-gray-500 font-mono text-sm">{shiftStr}</td>
                                    <td className="px-6 py-4 text-green-600 font-medium">
                                        {row.check_in ? new Date(row.check_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-blue-600 font-medium">
                                        {row.check_out ? new Date(row.check_out).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}
                                    </td>
                                    <td className="px-6 py-4 font-medium flex justify-between items-center">
                                        <span>{totalHours}</span>
                                        <button 
                                            onClick={() => openPunchesModal(row.pin, row.punch_date, row.full_name || row.pin)}
                                            className="text-blue-600 text-xs hover:underline ml-2 bg-blue-50 px-2 py-1 rounded font-medium cursor-pointer"
                                        >
                                            Edit Punches
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {reports.length === 0 && !errorMsg && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                    {loading ? 'Loading attendance records...' : 'No attendance records found for this period.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Punches Modal */}
            {selectedRowForPunches && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 animate-in fade-in">
                    <div className="bg-white rounded-xl p-6 max-w-lg w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-1">Edit Raw Punches</h3>
                        <p className="text-sm text-gray-500 mb-4">{selectedRowForPunches.name} &bull; {selectedRowForPunches.date}</p>
                        
                        <div className="max-h-60 overflow-y-auto mb-4 border border-gray-200 rounded-lg">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-4 py-2 font-medium text-gray-600">Time</th>
                                        <th className="px-4 py-2 font-medium text-gray-600">Source</th>
                                        <th className="px-4 py-2 font-medium text-gray-600 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {rawPunches.map((punch, i) => (
                                        <tr key={i}>
                                            <td className="px-4 py-2 font-medium">{new Date(punch.timestamp).toLocaleTimeString()}</td>
                                            <td className="px-4 py-2 text-gray-500">
                                                <span className={`px-2 py-0.5 rounded text-xs ${
                                                    punch.sn === 'MANUAL_ENTRY' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                    {punch.sn === 'MANUAL_ENTRY' ? 'Manual' : `Device (${punch.sn || 'ZK'})`}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                <button 
                                                    onClick={() => deletePunch(punch.timestamp)} 
                                                    className="text-red-600 hover:text-red-800 text-xs font-semibold cursor-pointer"
                                                >
                                                    Delete
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {rawPunches.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="px-4 py-4 text-center text-gray-500">No punches found for this date.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <form onSubmit={addManualPunch} className="flex gap-2">
                            <input 
                                type="time" 
                                value={newPunchTime} 
                                onChange={e => setNewPunchTime(e.target.value)} 
                                required 
                                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" 
                            />
                            <button 
                                type="submit" 
                                disabled={isSavingPunch}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                            >
                                {isSavingPunch ? 'Saving...' : 'Add Punch'}
                            </button>
                        </form>

                        <div className="mt-6 flex justify-end">
                            <button 
                                type="button"
                                onClick={() => setSelectedRowForPunches(null)} 
                                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 cursor-pointer"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
