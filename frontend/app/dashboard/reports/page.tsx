'use client';
import { useEffect, useState } from 'react';
import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function ReportsPage() {
    const [rangeType, setRangeType] = useState('daily');
    const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
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

    useEffect(() => {
        const fetchReports = async () => {
            setErrorMsg('');
            try {
                const res = await fetch(`/api/reports/daily?startDate=${startDate}&endDate=${endDate}`);
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
        fetchReports();
    }, [startDate, endDate]);

    const handleExportExcel = () => {
        window.location.href = `/api/reports/export?startDate=${startDate}&endDate=${endDate}`;
    };

    const handleExportPDF = () => {
        const doc = new jsPDF();
        
        if (reports.length === 0) {
            doc.text(`No attendance records found for ${startDate} to ${endDate}`, 14, 15);
            doc.save(`TimeCards_${startDate}_to_${endDate}.pdf`);
            return;
        }

        // Group reports by employee PIN
        const groupedReports = reports.reduce((acc, row) => {
            const empKey = row.pin;
            if (!acc[empKey]) {
                acc[empKey] = {
                    pin: row.pin,
                    name: row.full_name || row.pin,
                    department: row.department || '-',
                    records: []
                };
            }
            acc[empKey].records.push(row);
            return acc;
        }, {} as Record<string, any>);

        const employees = Object.values(groupedReports);

        employees.forEach((emp, index) => {
            if (index > 0) {
                doc.addPage();
            }

            // Print Header
            doc.setFontSize(16);
            doc.text(`Total Time Card`, 14, 15);
            
            doc.setFontSize(11);
            doc.text(`Date Range: ${startDate} to ${endDate}`, 14, 25);
            doc.text(`Emp No: ${emp.pin}`, 14, 32);
            doc.text(`Employee Name: ${emp.name}`, 14, 39);
            doc.text(`Department: ${emp.department}`, 14, 46);

            const tableColumn = ["Date", "Check In", "Check Out", "Punches"];
            const tableRows = emp.records.map((row: any) => [
                row.punch_date,
                row.check_in ? new Date(row.check_in).toLocaleTimeString() : '-',
                row.check_out ? new Date(row.check_out).toLocaleTimeString() : '-',
                row.total_punches
            ]);

            autoTable(doc, {
                head: [tableColumn],
                body: tableRows,
                startY: 52,
                theme: 'grid',
                headStyles: { fillColor: [41, 128, 185] }
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
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Department</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Date</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Check In</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Check Out</th>
                            <th className="px-6 py-4 text-sm font-medium text-gray-500">Total Punches</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {reports.map((row, idx) => (
                            <tr key={idx}>
                                <td className="px-6 py-4 font-medium">{row.full_name || row.pin}</td>
                                <td className="px-6 py-4 text-gray-500">{row.department || '-'}</td>
                                <td className="px-6 py-4 text-gray-500">{row.punch_date}</td>
                                <td className="px-6 py-4 text-green-600 font-medium">
                                    {row.check_in ? new Date(row.check_in).toLocaleTimeString() : '-'}
                                </td>
                                <td className="px-6 py-4 text-blue-600 font-medium">
                                    {row.check_out ? new Date(row.check_out).toLocaleTimeString() : '-'}
                                </td>
                                <td className="px-6 py-4">{row.total_punches}</td>
                            </tr>
                        ))}
                        {reports.length === 0 && !errorMsg && (
                            <tr>
                                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">No attendance records found for this period.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
