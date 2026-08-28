import * as XLSX from 'xlsx';
import { createAdminClient } from '@/lib/supabase/server';
import { DailyAttendanceSummary } from '@/types';
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
    excelBuffer: Buffer;
    excelFileName: string;
    branchName: string;
    startDate: string;
    endDate: string;
    totalEmployees: number;
    daysPresentCount: number;
    totalHoursFormatted: string;
}

export async function generateBranchReportBuffer(
    startDate: string,
    endDate: string,
    branch: string = 'all'
): Promise<GeneratedReportResult> {
    const supabase = createAdminClient();

    let query = supabase
        .from('daily_attendance_summary')
        .select('*')
        .gte('punch_date', startDate)
        .lte('punch_date', endDate)
        .order('punch_date', { ascending: true })
        .order('pin', { ascending: true });

    if (branch && branch !== 'all') {
        query = query.eq('branch', branch);
    }

    let empQuery = supabase.from('employees').select('*');
    if (branch && branch !== 'all') {
        empQuery = empQuery.eq('branch', branch);
    }

    const [attRes, empRes] = await Promise.all([query, empQuery]);

    const rawAttendance = (attRes.data || []) as DailyAttendanceSummary[];
    const allEmployees = (empRes.data || []) as Array<{ pin: string; full_name: string; branch?: string; department?: string }>;

    // Merge multi-punch records per employee per date
    const attendanceByEmpDate = new Map<string, DailyAttendanceSummary>();
    rawAttendance.forEach((row) => {
        const key = `${row.pin}_${row.punch_date}`;
        if (!attendanceByEmpDate.has(key)) {
            attendanceByEmpDate.set(key, { ...row });
        } else {
            const existing = attendanceByEmpDate.get(key)!;
            if (row.check_in && (!existing.check_in || new Date(row.check_in) < new Date(existing.check_in))) {
                existing.check_in = row.check_in;
            }
            if (row.check_out && (!existing.check_out || new Date(row.check_out) > new Date(existing.check_out))) {
                existing.check_out = row.check_out;
            }
            existing.total_punches = (existing.total_punches || 1) + (row.total_punches || 1);
            if (!existing.branch && row.branch) existing.branch = row.branch;
            if (!existing.device_name && row.device_name) existing.device_name = row.device_name;
            if (!existing.full_name && row.full_name) existing.full_name = row.full_name;
        }
    });

    const empMap = new Map<string, { pin: string; name: string; department: string; branch: string }>();
    allEmployees.forEach((e) => {
        empMap.set(e.pin, {
            pin: e.pin,
            name: e.full_name || `PIN ${e.pin}`,
            department: e.department || '',
            branch: e.branch || ''
        });
    });

    rawAttendance.forEach((r) => {
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
    const workbook = XLSX.utils.book_new();

    let grandTotalMinutes = 0;
    let grandTotalDaysPresent = 0;

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

        const worksheet = (XLSX.utils.json_to_sheet as any)(recordsWithStats, { origin: 'A4' });
        XLSX.utils.sheet_add_aoa(worksheet, headerData, { origin: 'A1' });
        XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
    });

    if (empMap.size === 0) {
        const emptySheet = XLSX.utils.json_to_sheet([{ Message: 'No records found for this period' }]);
        XLSX.utils.book_append_sheet(workbook, emptySheet, 'Attendance');
    }

    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const cleanBranch = (branch || 'All_Branches').replace(/[^a-zA-Z0-9_-]/g, '_');
    const excelFileName = `Attendance_${cleanBranch}_${startDate}_to_${endDate}.xlsx`;

    const grandHrs = Math.floor(grandTotalMinutes / 60);
    const grandMins = grandTotalMinutes % 60;

    return {
        excelBuffer,
        excelFileName,
        branchName: branch === 'all' ? 'All Branches' : branch,
        startDate,
        endDate,
        totalEmployees: empMap.size,
        daysPresentCount: grandTotalDaysPresent,
        totalHoursFormatted: `${grandHrs}h ${grandMins}m`
    };
}
