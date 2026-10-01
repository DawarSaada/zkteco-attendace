import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllPages, loadDailyReportRows } from '@/lib/reports/source';
import type { DailyAttendanceSummary } from '@/types';
import { formatPunchTime, formatTotalHours, calculateMinutes } from '@/lib/utils/formatTime';
import { format } from 'date-fns';

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

export interface GeneratedReportResult {
    excelBuffer?: Buffer;
    excelFileName?: string;
    pdfBuffer?: Buffer;
    pdfFileName?: string;
    branchName: string;
    startDate: string;
    endDate: string;
    reportFormat: 'excel' | 'pdf' | 'both';
    totalEmployees: number;
    daysPresentCount: number;
    totalHoursFormatted: string;
}

export async function generateBranchReportBuffer(
    startDate: string,
    endDate: string,
    branch: string = 'all',
    reportFormat: 'excel' | 'pdf' | 'both' = 'both'
): Promise<GeneratedReportResult> {
    const supabase = createAdminClient();

    const [attendanceResult, allEmployees] = await Promise.all([
        // Engine figures overlaid on the legacy punch log, paged past the row cap:
        // an emailed report used to silently stop at 1000 rows.
        loadDailyReportRows(supabase, { start: startDate, end: endDate, branch }),
        fetchAllPages<{ pin: string; full_name: string; branch?: string; department?: string }>(
            (from, to) => {
                let empQuery = supabase
                    .from('employees')
                    .select('*')
                    .order('pin', { ascending: true });
                if (branch && branch !== 'all') {
                    empQuery = empQuery.eq('branch', branch);
                }
                return empQuery.range(from, to);
            },
        ),
    ]);

    // One row per employee per date already, so this is a lookup, not a merge.
    const attendanceByEmpDate = new Map<string, DailyAttendanceSummary>();
    for (const row of attendanceResult.rows) {
        attendanceByEmpDate.set(`${row.pin}_${row.punch_date}`, row);
    }

    const empMap = new Map<string, { pin: string; name: string; department: string; branch: string }>();
    allEmployees.forEach((e) => {
        empMap.set(e.pin, {
            pin: e.pin,
            name: e.full_name || `PIN ${e.pin}`,
            department: e.department || '',
            branch: e.branch || ''
        });
    });

    attendanceResult.rows.forEach((r) => {
        if (!empMap.has(r.pin)) {
            empMap.set(r.pin, {
                pin: r.pin,
                name: r.full_name || `PIN ${r.pin}`,
                department: r.department || '',
                branch: r.branch || ''
            });
        }
    });

    const allDates = generateDateRange(startDate, endDate);
    const employees = Array.from(empMap.values());
    const cleanBranch = (branch || 'All_Branches').replace(/[^a-zA-Z0-9_-]/g, '_');

    let grandTotalMinutes = 0;
    let grandTotalDaysPresent = 0;

    let excelBuffer: Buffer | undefined;
    let excelFileName: string | undefined;

    // 1. Generate Excel Buffer if format is 'excel' or 'both'
    if (reportFormat === 'excel' || reportFormat === 'both') {
        const workbook = XLSX.utils.book_new();

        empMap.forEach((empInfo) => {
            let totalMinutes = 0;
            let daysPresent = 0;
            const records: Record<string, string>[] = [];

            allDates.forEach((dateStr) => {
                const pDate = new Date(`${dateStr}T00:00:00Z`);
                const weekday = format(pDate, 'EEEE');
                const key = `${empInfo.pin}_${dateStr}`;
                const log = attendanceByEmpDate.get(key);

                if (log && (log.check_in || log.check_out)) {
                    daysPresent += 1;
                    const mins = calculateMinutes(log.check_in, log.check_out);
                    totalMinutes += mins;

                    const hasBothPunches = log.check_in && log.check_out && log.check_in !== log.check_out;
                    const clockIn = formatPunchTime(log.check_in);
                    const clockOut = hasBothPunches ? formatPunchTime(log.check_out) : '';
                    const totalHours = hasBothPunches ? formatTotalHours(log.check_in, log.check_out) : '0h 0m';

                    records.push({
                        'Date': dateStr,
                        'Day': weekday,
                        'Schedule In': log.shift_start ? log.shift_start.substring(0, 5) : '--:--',
                        'Schedule Out': log.shift_end ? log.shift_end.substring(0, 5) : '--:--',
                        'Check In': clockIn,
                        'Check Out': clockOut,
                        'Total Hours': totalHours,
                        'Device Name': log.device_name || '-',
                        'Branch': log.branch || empInfo.branch || '-'
                    });
                } else {
                    records.push({
                        'Date': dateStr,
                        'Day': weekday,
                        'Schedule In': '--:--',
                        'Schedule Out': '--:--',
                        'Check In': '',
                        'Check Out': '',
                        'Total Hours': '',
                        'Device Name': '',
                        'Branch': empInfo.branch || '-'
                    });
                }
            });

            grandTotalMinutes += totalMinutes;
            grandTotalDaysPresent += daysPresent;

            const totalHrs = Math.floor(totalMinutes / 60);
            const totalMins = totalMinutes % 60;
            const formattedTotalHours = `${totalHrs}h ${totalMins}m`;

            const rawSheetName = empInfo.name || `PIN_${empInfo.pin}`;
            const safeSheetName = rawSheetName.replace(/[\\/?*[\]:]/g, '').substring(0, 31) || `PIN_${empInfo.pin}`;

            const deptString = empInfo.department ? `, Department: ${empInfo.department}` : '';
            const branchString = empInfo.branch ? `, Branch: ${empInfo.branch}` : '';

            const headerData = [
                [`Start Date: ${startDate}    End Date: ${endDate}`],
                [`Employee ID: ${empInfo.pin}, Name: ${empInfo.name}${deptString}${branchString}`],
                []
            ];

            const recordsWithStats = [
                ...records,
                {
                    'Date': 'Summary Statistics',
                    'Day': `Days Present: ${daysPresent}`,
                    'Schedule In': '',
                    'Schedule Out': '',
                    'Check In': '',
                    'Check Out': 'Total Hours:',
                    'Total Hours': formattedTotalHours,
                    'Device Name': '',
                    'Branch': ''
                }
            ];

            // `json_to_sheet()` is `sheet_add_json(null, …)` at runtime, but only the
            // latter's option type carries `origin`. Headers land at A1 either way.
            const worksheet = XLSX.utils.aoa_to_sheet(headerData);
            XLSX.utils.sheet_add_json(worksheet, recordsWithStats, { origin: 'A4' });
            XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
        });

        if (empMap.size === 0) {
            const emptySheet = XLSX.utils.json_to_sheet([{ Message: 'No records found for this period' }]);
            XLSX.utils.book_append_sheet(workbook, emptySheet, 'Attendance');
        }

        excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        excelFileName = `Attendance_${cleanBranch}_${startDate}_to_${endDate}.xlsx`;
    }

    let pdfBuffer: Buffer | undefined;
    let pdfFileName: string | undefined;

    // 2. Generate PDF Buffer if format is 'pdf' or 'both'
    if (reportFormat === 'pdf' || reportFormat === 'both') {
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        const tableColumn = [
            "Date", "Day", "Schedule In", "Schedule Out", 
            "Clock In", "Clock Out", "Total Hours", "Device", "Branch"
        ];

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

            let empTotalMinutes = 0;
            let empDaysPresent = 0;

            const tableRows = allDates.map((dateStr) => {
                const pDate = new Date(`${dateStr}T00:00:00Z`);
                const weekday = format(pDate, 'EEE');
                const key = `${emp.pin}_${dateStr}`;
                const log = attendanceByEmpDate.get(key);

                if (log && (log.check_in || log.check_out)) {
                    empDaysPresent += 1;
                    const mins = calculateMinutes(log.check_in, log.check_out);
                    empTotalMinutes += mins;

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

            if (reportFormat === 'pdf') {
                grandTotalMinutes += empTotalMinutes;
                grandTotalDaysPresent += empDaysPresent;
            }

            const totalHrs = Math.floor(empTotalMinutes / 60);
            const totalMins = empTotalMinutes % 60;
            const formattedTotalHours = `${totalHrs}h ${totalMins}m`;

            tableRows.push([
                'Summary:',
                `Days: ${empDaysPresent}`,
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
                    lineWidth: 0.1
                },
                alternateRowStyles: {
                    fillColor: [252, 253, 254]
                }
            });
        });

        if (employees.length === 0) {
            doc.text('No attendance records found for this period.', 10, 20);
        }

        const arrayBuffer = doc.output('arraybuffer');
        pdfBuffer = Buffer.from(arrayBuffer);
        pdfFileName = `Attendance_${cleanBranch}_${startDate}_to_${endDate}.pdf`;
    }

    const grandHrs = Math.floor(grandTotalMinutes / 60);
    const grandMins = grandTotalMinutes % 60;

    return {
        excelBuffer,
        excelFileName,
        pdfBuffer,
        pdfFileName,
        branchName: branch === 'all' ? 'All Branches' : branch,
        startDate,
        endDate,
        reportFormat,
        totalEmployees: empMap.size,
        daysPresentCount: grandTotalDaysPresent,
        totalHoursFormatted: `${grandHrs}h ${grandMins}m`
    };
}
