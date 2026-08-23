'use client';
import { useEffect, useState } from 'react';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function ReportsPage() {
    const [rangeType, setRangeType] = useState('daily');
    const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [employeesList, setEmployeesList] = useState<any[]>([]);
    const [filterPin, setFilterPin] = useState('all');
    const [filterBranch, setFilterBranch] = useState('all');

    // Punches Modal State
    const [selectedRowForPunches, setSelectedRowForPunches] = useState<any>(null);
    const [rawPunches, setRawPunches] = useState<any[]>([]);
    const [newPunchTime, setNewPunchTime] = useState('09:00');

    const openPunchesModal = async (pin: string, date: string, name: string) => {
        setSelectedRowForPunches({ pin, date, name });
        fetchRawPunches(pin, date);
    };

    const fetchRawPunches = async (pin: string, date: string) => {
        const res = await fetch(`/api/attendance/manual?pin=${pin}&date=${date}`);
        const data = await res.json();
        setRawPunches(data || []);
    };

    const deletePunch = async (timestamp: string) => {
        if (!confirm('Are you sure you want to delete this punch?')) return;
        await fetch('/api/attendance/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', pin: selectedRowForPunches.pin, timestamp })
        });
        fetchRawPunches(selectedRowForPunches.pin, selectedRowForPunches.date);
        fetchReports(); // Refresh main table
    };

    const addManualPunch = async (e: React.FormEvent) => {
        e.preventDefault();
        // Construct full ISO timestamp using the selected date and new punch time
        // Note: Using local time construction to match the selected date visually
        const localDateTimeStr = `${selectedRowForPunches.date}T${newPunchTime}:00`;
        const timestamp = new Date(localDateTimeStr).toISOString();

        await fetch('/api/attendance/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', pin: selectedRowForPunches.pin, timestamp })
        });
        fetchRawPunches(selectedRowForPunches.pin, selectedRowForPunches.date);
        fetchReports();
    };

    const [reports, setReports] = useState<any[]>([]);
    const [errorMsg, setErrorMsg] = useState('');

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

    const fetchReports = async () => {
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
        }
    };

    useEffect(() => {
        fetchReports();
    }, [startDate, endDate, filterPin, filterBranch]);

    const handleExportExcel = () => {
        window.location.href = `/api/reports/export?format=excel&start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`;
    };

    const handleExportPDF = async () => {
        const res = await fetch(`/api/reports/export?format=json&start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`);
        const data = await res.json();
        const doc = new jsPDF('landscape');
        
        if (data.length === 0) {
            doc.text(`No attendance records found for ${startDate} to ${endDate}`, 14, 15);
            doc.save(`TimeCards_${startDate}_to_${endDate}.pdf`);
            return;
        }

        const groupedReports = reports.reduce((acc, row) => {
            const empKey = row.pin;
            if (!acc[empKey]) {
                acc[empKey] = {
                    pin: row.pin,
                    name: row.full_name || row.pin,
                    department: row.department || '',
                    records: []
                };
            }
            acc[empKey].records.push(row);
            return acc;
        }, {} as Record<string, any>);

        const employees = Object.values(groupedReports);

        employees.forEach((emp: any, index) => {
            if (index > 0) {
                doc.addPage();
            }

            doc.setFontSize(10);
            doc.text(`Start Date ${startDate} End Date ${endDate}`, 14, 15);
            // Example: Employee ID: 1,First Name: Parvez,Department: القسم
            const deptString = emp.department ? `,Department: ${emp.department}` : '';
            doc.text(`Employee ID: ${emp.pin},First Name: ${emp.name}${deptString}`, 14, 22);

            const tableColumn = [
                "Date", "Weekday", "Timetable", "Check In", "Check Out", 
                "Normal", "Break", "Work day", "Clock In", "Clock Out", 
                "Total Hours", "Work Hours", "Break Out", "Break In"
            ];
            
            let totalMinutesAll = 0;

            const tableRows = emp.records.map((row: any) => {
                const pDate = new Date(row.punch_date);
                const weekday = format(pDate, 'EEEE');
                
                let clockIn = '';
                let clockOut = '';
                let totalHours = '';

                if (row.check_in) {
                    clockIn = format(new Date(row.check_in), 'HH:mm');
                }
                
                if (row.check_out && row.check_in !== row.check_out) {
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
                    row.shift_start ? row.shift_start.substring(0, 5) : '00:00', // Check In schedule
                    row.shift_end ? row.shift_end.substring(0, 5) : '00:00', // Check Out schedule
                    '', '', // Normal, Break
                    '1.0', // Work day
                    clockIn,
                    clockOut,
                    totalHours,
                    '12:00', // Work Hours hardcoded as in screenshot
                    '', '' // Break Out, Break In
                ];
            });

            // Statistics Row
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
                    fillColor: [255, 255, 255], 
                    textColor: [0, 0, 0],
                    fontStyle: 'normal'
                }
            });
        });

        doc.save(`TimeCards_${startDate}_to_${endDate}.pdf`);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-2xl font-bold">Attendance Report</h2>
                <div className="flex flex-wrap gap-4 items-center">
                    <select 
                        value={filterBranch} 
                        onChange={(e) => setFilterBranch(e.target.value)}
                        className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none bg-white"
                    >
                        <option value="all">All Branches</option>
                        {Array.from(new Set(employeesList.map(e => e.branch).filter(Boolean))).map(branch => (
                            <option key={branch} value={branch}>{branch}</option>
                        ))}
                    </select>

                    <select 
                        value={filterPin} 
                        onChange={(e) => setFilterPin(e.target.value)}
                        className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none bg-white"
                    >
                        <option value="all">All Employees</option>
                        {employeesList
                            .filter(e => filterBranch === 'all' || e.branch === filterBranch)
                            .map(emp => (
                            <option key={emp.pin} value={emp.pin}>{emp.full_name || emp.pin}</option>
                        ))}
                    </select>

                    <select 
                        value={rangeType} 
                        onChange={(e) => setRangeType(e.target.value)}
                        className="border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        <option value="daily">Daily</option>
                        <option value="weekly">This Week</option>
                        <option value="monthly">This Month</option>
                        <option value="custom">Custom Range</option>
                    </select>

                    {rangeType === 'custom' && (
                        <div className="flex items-center space-x-2">
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
                        className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
                    >
                        Export Excel
                    </button>
                    <button 
                        onClick={handleExportPDF}
                        className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
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
                                <tr key={idx}>
                                    <td className="px-6 py-4 font-medium">{row.full_name || row.pin}</td>
                                    <td className="px-6 py-4 text-gray-500">{row.punch_date}</td>
                                    <td className="px-6 py-4 text-gray-500 font-mono text-sm">{shiftStr}</td>
                                    <td className="px-6 py-4 text-green-600 font-medium">
                                        {row.check_in ? new Date(row.check_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-blue-600 font-medium">
                                        {row.check_out ? new Date(row.check_out).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '-'}
                                    </td>
                                    <td className="px-6 py-4 font-medium flex justify-between items-center">
                                        {totalHours}
                                        <button 
                                            onClick={() => openPunchesModal(row.pin, row.punch_date, row.full_name)}
                                            className="text-blue-500 text-xs hover:underline ml-2"
                                        >
                                            Edit Punches
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {reports.length === 0 && !errorMsg && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">No attendance records found for this period.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Punches Modal */}
            {selectedRowForPunches && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 max-w-lg w-full shadow-2xl">
                        <h3 className="text-xl font-bold mb-1">Edit Punches</h3>
                        <p className="text-sm text-gray-500 mb-4">{selectedRowForPunches.name} - {selectedRowForPunches.date}</p>
                        
                        <div className="max-h-60 overflow-y-auto mb-4 border rounded-lg">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 border-b">
                                    <tr>
                                        <th className="px-4 py-2">Time</th>
                                        <th className="px-4 py-2">Source</th>
                                        <th className="px-4 py-2">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rawPunches.map((punch: any, i) => (
                                        <tr key={i} className="border-b">
                                            <td className="px-4 py-2 font-medium">{new Date(punch.timestamp).toLocaleTimeString()}</td>
                                            <td className="px-4 py-2 text-gray-500">{punch.sn === 'MANUAL_ENTRY' ? 'Manual' : 'Device'}</td>
                                            <td className="px-4 py-2">
                                                <button onClick={() => deletePunch(punch.timestamp)} className="text-red-600 hover:underline">Delete</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {rawPunches.length === 0 && <tr><td colSpan={3} className="px-4 py-4 text-center text-gray-500">No punches</td></tr>}
                                </tbody>
                            </table>
                        </div>

                        <form onSubmit={addManualPunch} className="flex gap-2">
                            <input type="time" value={newPunchTime} onChange={e => setNewPunchTime(e.target.value)} required className="flex-1 border rounded-lg px-3 py-2" />
                            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg">Add Punch</button>
                        </form>

                        <div className="mt-6 flex justify-end">
                            <button onClick={() => setSelectedRowForPunches(null)} className="bg-gray-100 px-4 py-2 rounded-lg">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
