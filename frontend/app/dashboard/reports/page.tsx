'use client';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Employee, Device, DailyAttendanceSummary, RawPunch } from '@/types';
import { formatPunchTime, formatTotalHours, calculateMinutes } from '@/lib/utils/formatTime';
import { SortHeader } from '@/components/SortHeader';
import { useLanguage } from '@/components/LanguageContext';
import { 
    FileSpreadsheet, 
    FileText, 
    Edit3, 
    X, 
    RotateCw,
} from 'lucide-react';

function generateDateRange(start: string, end: string): string[] {
    const dates: string[] = [];
    const curr = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (curr <= last) {
        dates.push(curr.toISOString().substring(0, 10));
        curr.setUTCDate(curr.getUTCDate() + 1);
    }
    return dates;
}

export default function ReportsPage() {
    const [rangeType, setRangeType] = useState('monthly');
    const [startDate, setStartDate] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
    const [endDate, setEndDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
    const [employeesList, setEmployeesList] = useState<Employee[]>([]);
    const [devicesList, setDevicesList] = useState<Device[]>([]);
    const [filterPin, setFilterPin] = useState('all');
    const [filterBranch, setFilterBranch] = useState('all');
    const [loading, setLoading] = useState(false);
    const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Sorting State
    const [sortKey, setSortKey] = useState<string>('date');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    // Punches Modal State
    const [selectedRowForPunches, setSelectedRowForPunches] = useState<{ pin: string; date: string; name: string } | null>(null);
    const [rawPunches, setRawPunches] = useState<RawPunch[]>([]);
    const [newPunchTime, setNewPunchTime] = useState('09:00');
    const [newPunchStatus, setNewPunchStatus] = useState('0');
    const [isSavingPunch, setIsSavingPunch] = useState(false);

    // Inline Edit Punch state
    const [editingPunch, setEditingPunch] = useState<{ id?: string; oldTimestamp: string; time: string; status: string } | null>(null);

    const [reports, setReports] = useState<DailyAttendanceSummary[]>([]);
    const [errorMsg, setErrorMsg] = useState('');

    const { t, isRTL } = useLanguage();

    const showToast = (text: string, type: 'success' | 'error' = 'success') => {
        setToastMsg({ text, type });
        setTimeout(() => setToastMsg(null), 4000);
    };

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

    useEffect(() => {
        const today = new Date();
        if (rangeType === 'daily') {
            const todayStr = format(today, 'yyyy-MM-dd');
            setStartDate(todayStr);
            setEndDate(todayStr);
        } else if (rangeType === 'weekly') {
            setStartDate(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
            setEndDate(format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
        } else if (rangeType === 'payroll') {
            const prevMonth = subMonths(today, 1);
            const startYear = prevMonth.getFullYear();
            const startMonth = String(prevMonth.getMonth() + 1).padStart(2, '0');
            const endYear = today.getFullYear();
            const endMonth = String(today.getMonth() + 1).padStart(2, '0');
            setStartDate(`${startYear}-${startMonth}-26`);
            setEndDate(`${endYear}-${endMonth}-25`);
        } else if (rangeType === 'monthly') {
            setStartDate(format(startOfMonth(today), 'yyyy-MM-dd'));
            setEndDate(format(endOfMonth(today), 'yyyy-MM-dd'));
        }
    }, [rangeType]);

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

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(key);
            setSortOrder('asc');
        }
    };

    const sortedReports = useMemo(() => {
        const list = [...reports];
        list.sort((a, b) => {
            let valA: any = '';
            let valB: any = '';

            switch (sortKey) {
                case 'employee':
                    valA = a.full_name || `Employee ${a.pin}`;
                    valB = b.full_name || `Employee ${b.pin}`;
                    return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

                case 'date':
                    valA = a.punch_date;
                    valB = b.punch_date;
                    return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

                case 'shift':
                    valA = a.shift_start || '';
                    valB = b.shift_start || '';
                    return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);

                case 'check_in':
                    valA = a.check_in ? new Date(a.check_in).getTime() : 0;
                    valB = b.check_in ? new Date(b.check_in).getTime() : 0;
                    return sortOrder === 'asc' ? valA - valB : valB - valA;

                case 'check_out':
                    valA = a.check_out ? new Date(a.check_out).getTime() : 0;
                    valB = b.check_out ? new Date(b.check_out).getTime() : 0;
                    return sortOrder === 'asc' ? valA - valB : valB - valA;

                case 'duration':
                    valA = calculateMinutes(a.check_in, a.check_out);
                    valB = calculateMinutes(b.check_in, b.check_out);
                    return sortOrder === 'asc' ? valA - valB : valB - valA;

                default:
                    return 0;
            }
        });
        return list;
    }, [reports, sortKey, sortOrder]);

    const openPunchesModal = async (pin: string, date: string, name: string) => {
        setSelectedRowForPunches({ pin, date, name });
        setEditingPunch(null);
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

    const deletePunch = async (punch: RawPunch) => {
        if (!selectedRowForPunches) return;
        
        if (rawPunches.length === 2) {
            const confirmed = confirm(
                '⚠️ Attention: Deleting this punch will leave an unpaired punch for this day. Are you sure you want to proceed?'
            );
            if (!confirmed) return;
        } else {
            if (!confirm('Are you sure you want to delete this punch record?')) return;
        }
        
        try {
            const res = await fetch('/api/attendance/manual', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    id: punch.id, 
                    pin: selectedRowForPunches.pin, 
                    timestamp: punch.timestamp 
                })
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
                body: JSON.stringify({ 
                    pin: selectedRowForPunches.pin, 
                    timestamp,
                    status: newPunchStatus,
                    verify_mode: '0',
                    work_code: 0
                })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Manual punch recorded with audit trail.');
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

    const handleSavePunchEdit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRowForPunches || !editingPunch) return;
        setIsSavingPunch(true);

        try {
            const localDateTimeStr = `${selectedRowForPunches.date}T${editingPunch.time}:00Z`;
            const newIso = new Date(localDateTimeStr).toISOString();

            const res = await fetch('/api/attendance/manual', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingPunch.id,
                    pin: selectedRowForPunches.pin,
                    old_timestamp: editingPunch.oldTimestamp,
                    timestamp: newIso,
                    status: editingPunch.status
                })
            });
            const data = await res.json();
            if (res.ok) {
                showToast('Punch modified successfully with audit trail.');
                setEditingPunch(null);
                fetchRawPunches(selectedRowForPunches.pin, selectedRowForPunches.date);
                fetchReports();
            } else {
                showToast(data.error || 'Failed to update punch.', 'error');
            }
        } catch (err: unknown) {
            showToast(err instanceof Error ? err.message : 'Error updating punch.', 'error');
        } finally {
            setIsSavingPunch(false);
        }
    };

    const handleExportExcel = () => {
        window.location.href = `/api/reports/export?start=${startDate}&end=${endDate}&pin=${filterPin}&branch=${filterBranch}`;
    };

    const handleExportPDF = () => {
        const allDates = generateDateRange(startDate, endDate);

        const empMap = new Map<string, {
            pin: string;
            name: string;
            department: string;
            branch: string;
        }>();

        employeesList.forEach(e => {
            if (filterPin !== 'all' && e.pin !== filterPin) return;
            if (filterBranch !== 'all' && e.branch !== filterBranch) return;
            empMap.set(e.pin, {
                pin: e.pin,
                name: e.full_name || `PIN ${e.pin}`,
                department: e.department || '',
                branch: e.branch || ''
            });
        });

        reports.forEach(r => {
            if (filterPin !== 'all' && r.pin !== filterPin) return;
            if (filterBranch !== 'all' && r.branch !== filterBranch) return;
            if (!empMap.has(r.pin)) {
                empMap.set(r.pin, {
                    pin: r.pin,
                    name: r.full_name || `PIN ${r.pin}`,
                    department: r.department || '',
                    branch: r.branch || ''
                });
            }
        });

        const employees = Array.from(empMap.values());
        if (employees.length === 0) {
            showToast('No employees found to generate PDF.', 'error');
            return;
        }

        const attendanceMap = new Map<string, DailyAttendanceSummary>();
        reports.forEach(r => {
            attendanceMap.set(`${r.pin}_${r.punch_date}`, r);
        });

        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        employees.forEach((emp, index) => {
            if (index > 0) {
                doc.addPage('a4', 'landscape');
            }

            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('Monthly Employee Time Card Report', 10, 8.5);

            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(`Period: ${startDate} to ${endDate}`, 10, 13);

            const deptText = emp.department ? ` | Dept: ${emp.department}` : '';
            const branchText = emp.branch ? ` | Branch: ${emp.branch}` : '';
            doc.setFont('helvetica', 'bold');
            doc.text(`Employee ID: ${emp.pin} | Name: ${emp.name}${deptText}${branchText}`, 10, 17);

            const tableColumn = [
                "Date", "Day", "Schedule In", "Schedule Out", 
                "Clock In", "Clock Out", "Total Hours", "Device", "Branch"
            ];

            let totalMinutes = 0;
            let daysPresent = 0;

            const tableRows = allDates.map((dateStr) => {
                const pDate = new Date(`${dateStr}T00:00:00Z`);
                const weekday = format(pDate, 'EEE');
                const key = `${emp.pin}_${dateStr}`;
                const log = attendanceMap.get(key);

                if (log && (log.check_in || log.check_out)) {
                    daysPresent += 1;
                    const mins = calculateMinutes(log.check_in, log.check_out);
                    totalMinutes += mins;

                    const hasBothPunches = log.check_in && log.check_out && log.check_in !== log.check_out;
                    const clockIn = formatPunchTime(log.check_in);
                    const clockOut = hasBothPunches ? formatPunchTime(log.check_out) : '';
                    const totalHours = hasBothPunches ? formatTotalHours(log.check_in, log.check_out) : '0h 0m';

                    return [
                        dateStr,
                        weekday,
                        log.shift_start ? log.shift_start.substring(0, 5) : '--:--',
                        log.shift_end ? log.shift_end.substring(0, 5) : '--:--',
                        clockIn,
                        clockOut,
                        totalHours,
                        log.device_name || '-',
                        log.branch || emp.branch || '-'
                    ];
                } else {
                    return [
                        dateStr,
                        weekday,
                        '--:--',
                        '--:--',
                        '',
                        '',
                        '',
                        '',
                        emp.branch || '-'
                    ];
                }
            });

            const totalHrs = Math.floor(totalMinutes / 60);
            const totalMins = totalMinutes % 60;
            const formattedTotalHours = `${totalHrs}h ${totalMins}m`;

            tableRows.push([
                'Summary:',
                `Days: ${daysPresent}`,
                '',
                '',
                'Total Hours:',
                '',
                formattedTotalHours,
                '',
                ''
            ]);

            autoTable(doc, {
                head: [tableColumn],
                body: tableRows,
                startY: 19,
                margin: { top: 19, bottom: 5, left: 8, right: 8 },
                theme: 'grid',
                pageBreak: 'avoid',
                styles: { 
                    fontSize: 6.3,
                    cellPadding: 0.65,
                    minCellHeight: 3.4,
                    overflow: 'ellipsize',
                    lineColor: [210, 210, 210],
                    lineWidth: 0.1,
                    textColor: [30, 30, 30]
                },
                headStyles: { 
                    fillColor: [240, 244, 248], 
                    textColor: [20, 20, 20],
                    fontStyle: 'bold',
                    fontSize: 6.8,
                    cellPadding: 0.8
                },
                columnStyles: {
                    0: { cellWidth: 24 },
                    1: { cellWidth: 14 },
                    2: { cellWidth: 22 },
                    3: { cellWidth: 22 },
                    4: { cellWidth: 22 },
                    5: { cellWidth: 22 },
                    6: { cellWidth: 24 },
                    7: { cellWidth: 'auto' },
                    8: { cellWidth: 'auto' }
                }
            });
        });

        doc.save(`TimeCards_${startDate}_to_${endDate}.pdf`);
        showToast('PDF exported successfully!');
    };

    const allBranches = [
        ...employeesList.map(e => e.branch),
        ...devicesList.map(d => d.branch)
    ].filter(Boolean) as string[];
    const uniqueBranches = Array.from(new Set(allBranches));

    const combinedEmployees = useMemo(() => {
        const empMap = new Map<string, { pin: string; full_name: string; branch?: string }>();
        employeesList.forEach(e => {
            empMap.set(e.pin, { pin: e.pin, full_name: e.full_name || '', branch: e.branch || '' });
        });
        reports.forEach(r => {
            if (!empMap.has(r.pin)) {
                empMap.set(r.pin, { pin: r.pin, full_name: r.full_name || '', branch: r.branch || '' });
            }
        });
        return Array.from(empMap.values()).sort((a, b) => {
            if (a.full_name && b.full_name) return a.full_name.localeCompare(b.full_name);
            return a.pin.localeCompare(b.pin, undefined, { numeric: true });
        });
    }, [employeesList, reports]);

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

            {/* Header Title & Export Buttons */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-2 border-b border-slate-200 dark:border-slate-800/60">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        {t('reports_title')}
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {t('reports_subtitle')}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <button 
                        type="button"
                        onClick={handleExportExcel}
                        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm shadow-emerald-600/20 transition-all cursor-pointer"
                    >
                        <FileSpreadsheet size={16} />
                        <span>{t('btn_export_excel')}</span>
                    </button>
                    <button 
                        type="button"
                        onClick={handleExportPDF}
                        className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm shadow-red-600/20 transition-all cursor-pointer"
                    >
                        <FileText size={16} />
                        <span>{t('btn_export_pdf')}</span>
                    </button>
                </div>
            </div>

            {/* Filter Toolbar */}
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs flex flex-wrap items-center gap-3">
                {/* Branch Filter */}
                <div className="w-full sm:w-auto flex-1 min-w-[180px]">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        {t('filter_branch')}
                    </label>
                    <select 
                        value={filterBranch} 
                        onChange={(e) => setFilterBranch(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                        <option value="all">{t('filter_all_branches')}</option>
                        {uniqueBranches.map(branch => (
                            <option key={branch} value={branch}>{branch}</option>
                        ))}
                    </select>
                </div>

                {/* Employee Filter */}
                <div className="w-full sm:w-auto flex-1 min-w-[220px]">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        {t('filter_employee')}
                    </label>
                    <select 
                        value={filterPin} 
                        onChange={(e) => setFilterPin(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                        <option value="all">{t('filter_all_employees')} ({combinedEmployees.length})</option>
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
                </div>

                {/* Range Preset */}
                <div className="w-full sm:w-auto min-w-[140px]">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                        {t('filter_timeframe')}
                    </label>
                    <select 
                        value={rangeType} 
                        onChange={(e) => setRangeType(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                        <option value="monthly">{t('range_monthly')}</option>
                        <option value="payroll">{t('range_payroll')}</option>
                        <option value="weekly">{t('range_weekly')}</option>
                        <option value="daily">{t('range_daily')}</option>
                        <option value="custom">{t('range_custom')}</option>
                    </select>
                </div>

                {/* Custom Dates */}
                {rangeType === 'custom' && (
                    <div className="w-full sm:w-auto flex items-center gap-2 pt-2 sm:pt-4">
                        <input 
                            type="date" 
                            value={startDate} 
                            onChange={(e) => setStartDate(e.target.value)} 
                            className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-xs text-slate-400">{t('date_to')}</span>
                        <input 
                            type="date" 
                            value={endDate} 
                            onChange={(e) => setEndDate(e.target.value)} 
                            className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                )}
            </div>

            {errorMsg && (
                <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 text-sm">
                    {errorMsg}
                </div>
            )}

            {/* Reports Table with Interactive Column Sorting */}
            <div className="rounded-2xl bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800/80 shadow-xs overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                    <table className="w-full text-left rtl:text-right">
                        <thead className="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80">
                            <tr>
                                <SortHeader 
                                    columnKey="employee" 
                                    label={t('col_employee')} 
                                    activeKey={sortKey} 
                                    sortOrder={sortOrder} 
                                    onSort={handleSort} 
                                />
                                <SortHeader 
                                    columnKey="date" 
                                    label={t('col_date')} 
                                    activeKey={sortKey} 
                                    sortOrder={sortOrder} 
                                    onSort={handleSort} 
                                />
                                <SortHeader 
                                    columnKey="shift" 
                                    label={t('col_shift_schedule')} 
                                    activeKey={sortKey} 
                                    sortOrder={sortOrder} 
                                    onSort={handleSort} 
                                />
                                <SortHeader 
                                    columnKey="check_in" 
                                    label={t('col_check_in')} 
                                    activeKey={sortKey} 
                                    sortOrder={sortOrder} 
                                    onSort={handleSort} 
                                />
                                <SortHeader 
                                    columnKey="check_out" 
                                    label={t('col_check_out')} 
                                    activeKey={sortKey} 
                                    sortOrder={sortOrder} 
                                    onSort={handleSort} 
                                />
                                <SortHeader 
                                    columnKey="duration" 
                                    label={t('col_duration')} 
                                    activeKey={sortKey} 
                                    sortOrder={sortOrder} 
                                    onSort={handleSort} 
                                />
                                <th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right rtl:text-left">
                                    {t('col_audit_punches')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-sm">
                            {sortedReports.map((row, idx) => {
                                const hasBothPunches = row.check_in && row.check_out && row.check_in !== row.check_out;
                                const totalHours = hasBothPunches ? formatTotalHours(row.check_in, row.check_out) : '0h 0m';
                                const checkInTime = formatPunchTime(row.check_in);
                                const checkOutTime = hasBothPunches ? formatPunchTime(row.check_out) : '--:--';
                                
                                const shiftStr = (row.shift_start && row.shift_end) 
                                    ? `${row.shift_start.substring(0,5)} - ${row.shift_end.substring(0,5)}` 
                                    : t('unassigned');

                                return (
                                    <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                                            <div className="font-semibold">{row.full_name || `Employee ${row.pin}`}</div>
                                            <div className="text-xs text-slate-400 dark:text-slate-500">
                                                PIN: {row.pin} {row.branch ? ` • ${row.branch}` : ''}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300">
                                            {row.punch_date}
                                        </td>
                                        <td className="px-6 py-4 font-mono text-xs text-slate-500 dark:text-slate-400">
                                            {shiftStr}
                                        </td>
                                        <td className="px-6 py-4 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                            {checkInTime}
                                        </td>
                                        <td className="px-6 py-4 font-mono font-bold text-blue-600 dark:text-blue-400">
                                            {checkOutTime}
                                        </td>
                                        <td className="px-6 py-4 font-mono font-semibold text-slate-800 dark:text-slate-200">
                                            {totalHours}
                                        </td>
                                        <td className="px-6 py-4 text-right rtl:text-left">
                                            <button 
                                                type="button"
                                                onClick={() => openPunchesModal(row.pin, row.punch_date, row.full_name || row.pin)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs font-semibold border border-blue-200 dark:border-blue-800/60 transition-colors cursor-pointer"
                                            >
                                                <Edit3 size={13} />
                                                <span>{t('btn_manage_punches')}</span>
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {sortedReports.length === 0 && !errorMsg && (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400 dark:text-slate-500">
                                        {loading ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <RotateCw size={18} className="animate-spin text-blue-500" />
                                                <span>{t('loading')}</span>
                                            </div>
                                        ) : t('no_reports_found')}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Manual Punches & Audit Trail Modal */}
            {selectedRowForPunches && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-150">
                    <div className="bg-white dark:bg-[#0c121e] rounded-2xl p-4 sm:p-6 max-w-xl w-full shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4 sm:space-y-5 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800/80">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                                    {t('modal_manual_title')}
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {selectedRowForPunches.name} • PIN: {selectedRowForPunches.pin} • {selectedRowForPunches.date}
                                </p>
                            </div>
                            <button 
                                type="button"
                                onClick={() => setSelectedRowForPunches(null)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Raw Punches List */}
                        <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
                            <table className="w-full text-left rtl:text-right text-xs">
                                <thead className="bg-slate-100 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 uppercase tracking-wider font-semibold">
                                    <tr>
                                        <th className="px-4 py-2.5">{t('modal_time_label')}</th>
                                        <th className="px-4 py-2.5">{t('col_status')}</th>
                                        <th className="px-4 py-2.5">{t('col_source_device')}</th>
                                        <th className="px-4 py-2.5 text-right rtl:text-left">{t('actions')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                    {rawPunches.map((punch, i) => {
                                        const isPunchIn = punch.status === '0' || punch.status === 0;
                                        const punchTimeFormatted = formatPunchTime(punch.timestamp);

                                        return (
                                            <tr key={punch.id || i} className="hover:bg-white dark:hover:bg-slate-800/40">
                                                <td className="px-4 py-2.5 font-mono font-bold text-slate-900 dark:text-slate-100">
                                                    {punchTimeFormatted}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                        isPunchIn ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400' : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400'
                                                    }`}>
                                                        {isPunchIn ? t('status_checkin') : t('status_checkout')}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                                                    {punch.is_manual || !punch.sn ? (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-semibold text-[10px]">
                                                            {t('source_manual')}
                                                        </span>
                                                    ) : (
                                                        <span className="font-mono text-[11px]">{punch.sn}</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5 text-right rtl:text-left space-x-2 rtl:space-x-reverse">
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingPunch({
                                                            id: punch.id,
                                                            oldTimestamp: punch.timestamp,
                                                            time: punchTimeFormatted,
                                                            status: String(punch.status || '0')
                                                        })}
                                                        className="text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer text-xs"
                                                    >
                                                        {t('edit')}
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={() => deletePunch(punch)} 
                                                        className="text-red-600 dark:text-red-400 hover:underline font-semibold cursor-pointer text-xs"
                                                    >
                                                        {t('delete')}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {rawPunches.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                                                {t('no_reports_found')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Inline Punch Editor */}
                        {editingPunch ? (
                            <form onSubmit={handleSavePunchEdit} className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                                        {t('modal_modifying_punch')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setEditingPunch(null)}
                                        className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                    >
                                        {t('btn_cancel_edit')}
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">{t('modal_time_label')}</label>
                                        <input 
                                            type="time" 
                                            value={editingPunch.time} 
                                            onChange={e => setEditingPunch({ ...editingPunch, time: e.target.value })} 
                                            required 
                                            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800 text-sm" 
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">{t('modal_punch_type')}</label>
                                        <select
                                            value={editingPunch.status}
                                            onChange={e => setEditingPunch({ ...editingPunch, status: e.target.value })}
                                            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#0c121e] border border-slate-200 dark:border-slate-800 text-sm"
                                        >
                                            <option value="0">{t('status_checkin')}</option>
                                            <option value="1">{t('status_checkout')}</option>
                                        </select>
                                    </div>
                                </div>
                                <button
                                    type="submit"
                                    disabled={isSavingPunch}
                                    className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm cursor-pointer disabled:opacity-50"
                                >
                                    {isSavingPunch ? t('saving') : t('btn_save_punch_update')}
                                </button>
                            </form>
                        ) : (
                            /* Add Punch Form */
                            <form onSubmit={addManualPunch} className="space-y-3 pt-2">
                                <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                                    {t('modal_record_new_punch')}
                                </span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">{t('modal_time_label')}</label>
                                        <input 
                                            type="time" 
                                            value={newPunchTime} 
                                            onChange={e => setNewPunchTime(e.target.value)} 
                                            required 
                                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100" 
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">{t('modal_punch_type')}</label>
                                        <select
                                            value={newPunchStatus}
                                            onChange={e => setNewPunchStatus(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-slate-100"
                                        >
                                            <option value="0">{t('status_checkin')}</option>
                                            <option value="1">{t('status_checkout')}</option>
                                        </select>
                                    </div>
                                </div>
                                <button 
                                    type="submit" 
                                    disabled={isSavingPunch}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-xl text-sm font-semibold shadow-sm shadow-blue-500/20 disabled:opacity-50 cursor-pointer transition-all"
                                >
                                    {isSavingPunch ? t('saving') : t('btn_add_manual_punch')}
                                </button>
                            </form>
                        )}

                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex justify-end rtl:justify-start">
                            <button 
                                type="button"
                                onClick={() => setSelectedRowForPunches(null)} 
                                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-sm font-medium transition-colors cursor-pointer"
                            >
                                {t('done')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
