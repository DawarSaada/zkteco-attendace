'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Employee, Device, DailyAttendanceSummary, RawPunch } from '@/types';
import { formatPunchTime, formatTotalHours, calculateMinutes } from '@/lib/utils/formatTime';

export default function ReportsPage() {
    const [rangeType, setRangeType] = useState('daily');
    const [startDate, setStartDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
    const [employeesList, setEmployeesList] = useState<Employee[]>([]);
    const [devicesList, setDevicesList] = useState<Device[]>([]);
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

    // 1. Fetch employees and devices on mount to populate dynamic filter lists
    useEffect(() => {
        const fetchFiltersData = async () => {
            try {
                const [empRes, devRes] = await Promise.all([
                    fetch('/api/employees'),
                    fetch('/api/devices')
                ]);
                if (empRes.ok) {
                    const empData = await empRes.json();
                    setEmployeesList(Array.isArray(empData) ? empData : []);
                }
                if (devRes.ok) {
                    const devData = await devRes.json();
                    setDevicesList(Array.isArray(devData) ? devData : []);
                }
            } catch (err: unknown) {
                console.error('Error fetching filter data:', err);
            }
        };
        fetchFiltersData();
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
    const fetchReports = useCallback(async () => {
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
        } catch (err: unknown) {
            setReports([]);
            setErrorMsg(err instanceof Error ? err.message : 'Error occurred while fetching data.');
        } finally {
            setLoading(false);
        }
    }, [startDate, endDate, filterPin, filterBranch]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

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
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error loading punches', 'error');
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
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error deleting punch.', 'error');
        }
    };

    const addManualPunch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRowForPunches) return;
        setIsSavingPunch(true);

        try {
            const localDateTimeStr = `${selectedRowForPunches.date}T${newPunchTime}:00Z`;
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
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error adding punch.', 'error');
        } finally {
            setIsSavingPunch(false);
        }
    };

    // 5. Excel Export Handler
    const handleExportExcel = () => {
        window.location.href = `/api/reports/export?start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`;
    };

    // 6. PDF Export: Exactly 1 Page Per Employee Per Month (Never cross onto a 2nd page)
    const handleExportPDF = () => {
        if (reports.length === 0) {
            showToast('No attendance records available to generate PDF.', 'error');
            return;
        }

        // A4 Landscape: 297mm x 210mm
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        // Group rows by employee PIN
        const groupedReports = reports.reduce((acc, row) => {
            const empKey = row.pin;
            if (!acc[empKey]) {
                acc[empKey] = {
                    pin: row.pin,
                    name: row.full_name || `PIN ${row.pin}`,
                    department: row.department || '',
                    branch: row.branch || '',
                    records: [],
                    totalMinutes: 0,
                    daysPresent: 0
                };
            }
            acc[empKey].records.push(row);
            const mins = calculateMinutes(row.check_in, row.check_out);
            acc[empKey].totalMinutes += mins;
            if (row.check_in) {
                acc[empKey].daysPresent += 1;
            }
            return acc;
        }, {} as Record<string, {
            pin: string;
            name: string;
            department: string;
            branch: string;
            records: DailyAttendanceSummary[];
            totalMinutes: number;
            daysPresent: number;
        }>);

        const employees = Object.values(groupedReports);

        employees.forEach((emp, index) => {
            if (index > 0) {
                doc.addPage('a4', 'landscape');
            }

            // Compact Header at top of page
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text('Monthly Employee Time Card Report', 10, 9);

            doc.setFontSize(8.5);
            doc.setFont('helvetica', 'normal');
            doc.text(`Period: ${startDate} to ${endDate}`, 10, 14);

            const deptText = emp.department ? ` | Dept: ${emp.department}` : '';
            const branchText = emp.branch ? ` | Branch: ${emp.branch}` : '';
            doc.setFont('helvetica', 'bold');
            doc.text(`Employee ID: ${emp.pin} | Name: ${emp.name}${deptText}${branchText}`, 10, 18.5);

            // Table Columns
            const tableColumn = [
                "Date", "Day", "Schedule In", "Schedule Out", 
                "Clock In", "Clock Out", "Total Hours", "Device", "Branch"
            ];

            const tableRows = emp.records.map((row) => {
                const pDate = new Date(row.punch_date);
                const weekday = format(pDate, 'EEE'); // Abbreviated Day for clean width
                const clockIn = formatPunchTime(row.check_in);
                const clockOut = formatPunchTime(row.check_out);
                const totalHours = formatTotalHours(row.check_in, row.check_out);

                return [
                    row.punch_date,
                    weekday,
                    row.shift_start ? row.shift_start.substring(0, 5) : '--:--',
                    row.shift_end ? row.shift_end.substring(0, 5) : '--:--',
                    clockIn,
                    clockOut,
                    totalHours,
                    row.device_name || '-',
                    row.branch || emp.branch || '-'
                ];
            });

            // Summary Statistics Row
            const totalHrs = Math.floor(emp.totalMinutes / 60);
            const totalMins = emp.totalMinutes % 60;
            const formattedTotalHours = `${totalHrs}h ${totalMins}m`;

            tableRows.push([
                'Summary:',
                `Days: ${emp.daysPresent}`,
                '',
                '',
                'Total Hours:',
                '',
                formattedTotalHours,
                '',
                ''
            ]);

            // Precise density scaling: up to 32 rows fit easily on 1 landscape A4 page (210mm height)
            const rowCount = tableRows.length;
            const isDense = rowCount > 18;
            const fontSize = isDense ? 6.5 : 7.5;
            const cellPadding = isDense ? 0.8 : 1.3;
            const minCellHeight = isDense ? 3.6 : 4.4;

            autoTable(doc, {
                head: [tableColumn],
                body: tableRows,
                startY: 21,
                margin: { top: 21, bottom: 6, left: 8, right: 8 },
                theme: 'grid',
                pageBreak: 'avoid', // Guarantee no unwanted page breaks
                styles: { 
                    fontSize: fontSize,
                    cellPadding: cellPadding,
                    minCellHeight: minCellHeight,
                    overflow: 'ellipsize',
                    lineColor: [210, 210, 210],
                    lineWidth: 0.1,
                    textColor: [30, 30, 30]
                },
                headStyles: { 
                    fillColor: [240, 244, 248], 
                    textColor: [20, 20, 20],
                    fontStyle: 'bold',
                    fontSize: fontSize + 0.5,
                    cellPadding: cellPadding + 0.2
                },
                columnStyles: {
                    0: { cellWidth: 26 }, // Date
                    1: { cellWidth: 16 }, // Day
                    2: { cellWidth: 24 }, // Schedule In
                    3: { cellWidth: 24 }, // Schedule Out
                    4: { cellWidth: 22 }, // Clock In
                    5: { cellWidth: 22 }, // Clock Out
                    6: { cellWidth: 24 }, // Total Hours
                    7: { cellWidth: 'auto' }, // Device
                    8: { cellWidth: 'auto' }  // Branch
                }
            });
        });

        doc.save(`TimeCards_${startDate}_to_${endDate}.pdf`);
        showToast('PDF exported successfully (1 page per employee)!');
    };

    // Calculate unique branch list from both employees and devices
    const allBranches = [
        ...employeesList.map(e => e.branch),
        ...devicesList.map(d => d.branch)
    ].filter(Boolean) as string[];
    const uniqueBranches = Array.from(new Set(allBranches));

    // Combine all unique employees from both API list and active report records
    // This ensures every employee with records or in the database appears with name and PIN number
    const combinedEmployees = useMemo(() => {
        const empMap = new Map<string, { pin: string; full_name: string; branch?: string }>();
        
        employeesList.forEach(e => {
            empMap.set(e.pin, {
                pin: e.pin,
                full_name: e.full_name || '',
                branch: e.branch || ''
            });
        });

        reports.forEach(r => {
            if (!empMap.has(r.pin)) {
                empMap.set(r.pin, {
                    pin: r.pin,
                    full_name: r.full_name || '',
                    branch: r.branch || ''
                });
            }
        });

        return Array.from(empMap.values()).sort((a, b) => {
            if (a.full_name && b.full_name) {
                return a.full_name.localeCompare(b.full_name);
            }
            return a.pin.localeCompare(b.pin, undefined, { numeric: true });
        });
    }, [employeesList, reports]);

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
                <div className="flex flex-wrap gap-3 items-center">
                    {/* Branch Filter */}
                    <select 
                        value={filterBranch} 
                        onChange={(e) => setFilterBranch(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                    >
                        <option value="all">All Branches</option>
                        {uniqueBranches.map(branch => (
                            <option key={branch} value={branch}>{branch}</option>
                        ))}
                    </select>

                    {/* Employee Filter: Displays both Employee Name and PIN Number */}
                    <select 
                        value={filterPin} 
                        onChange={(e) => setFilterPin(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm max-w-xs"
                    >
                        <option value="all">All Employees ({combinedEmployees.length})</option>
                        {combinedEmployees
                            .filter(e => filterBranch === 'all' || e.branch === filterBranch)
                            .map(emp => {
                                const displayName = emp.full_name 
                                    ? `${emp.full_name} (${emp.pin})` 
                                    : `PIN: ${emp.pin}`;
                                return (
                                    <option key={emp.pin} value={emp.pin}>
                                        {displayName}
                                    </option>
                                );
                            })}
                    </select>

                    {/* Range Type */}
                    <select 
                        value={rangeType} 
                        onChange={(e) => setRangeType(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
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
                            const totalHours = formatTotalHours(row.check_in, row.check_out);
                            const shiftStr = (row.shift_start && row.shift_end) 
                                ? `${row.shift_start.substring(0,5)} - ${row.shift_end.substring(0,5)}` 
                                : 'No Shift';

                            return (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 font-medium">
                                        <div>{row.full_name || row.pin}</div>
                                        <div className="text-xs text-gray-400">PIN: {row.pin}{row.branch ? ` &bull; ${row.branch}` : ''}</div>
                                    </td>
                                    <td className="px-6 py-4 text-gray-500">{row.punch_date}</td>
                                    <td className="px-6 py-4 text-gray-500 font-mono text-sm">{shiftStr}</td>
                                    <td className="px-6 py-4 text-green-600 font-medium font-mono">
                                        {formatPunchTime(row.check_in)}
                                    </td>
                                    <td className="px-6 py-4 text-blue-600 font-medium font-mono">
                                        {formatPunchTime(row.check_out)}
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
                                        <th className="px-4 py-2 font-medium text-gray-600">Time (UTC)</th>
                                        <th className="px-4 py-2 font-medium text-gray-600">Source</th>
                                        <th className="px-4 py-2 font-medium text-gray-600 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {rawPunches.map((punch, i) => (
                                        <tr key={i}>
                                            <td className="px-4 py-2 font-medium font-mono">{formatPunchTime(punch.timestamp)}</td>
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
