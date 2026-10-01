import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { formatPunchTime, formatTotalHours, calculateMinutes } from '@/lib/utils/formatTime';
import { fetchAllPages, loadDailyReportRows } from '@/lib/reports/source';
import * as XLSX from 'xlsx';
import type { DailyAttendanceSummary } from '@/types';
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

export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const startDate = searchParams.get('start');
        const endDate = searchParams.get('end');
        const pin = searchParams.get('pin');
        const branch = searchParams.get('branch');

        if (!startDate || !endDate) {
            return NextResponse.json({ error: 'Missing dates' }, { status: 400 });
        }

        // 1. Attendance rows for the range: engine figures overlaid on the legacy
        // punch log, paged so a long range is never truncated at the row cap.
        const [attendanceResult, allEmployees] = await Promise.all([
            loadDailyReportRows(supabase, { start: startDate, end: endDate, pin, branch }),
            fetchAllPages<{ pin: string; full_name: string; branch?: string; department?: string }>(
                (from, to) =>
                    supabase
                        .from('employees')
                        .select('*')
                        .order('pin', { ascending: true })
                        .range(from, to),
            ),
        ]);

        // `loadDailyReportRows` already collapses multi-punch days to one row per
        // employee per date, so the grid below has a single source of truth.
        const attendanceByEmpDate = new Map<string, DailyAttendanceSummary>();
        for (const row of attendanceResult.rows) {
            attendanceByEmpDate.set(`${row.pin}_${row.punch_date}`, row);
        }

        // 3. Build list of targeted employees
        const empMap = new Map<string, { pin: string; name: string; department: string; branch: string; defaultShiftStart?: string; defaultShiftEnd?: string }>();
        
        allEmployees.forEach(e => {
            if (pin && pin !== 'all' && e.pin !== pin) return;
            if (branch && branch !== 'all' && e.branch !== branch) return;
            empMap.set(e.pin, {
                pin: e.pin,
                name: e.full_name || `PIN ${e.pin}`,
                department: e.department || '',
                branch: e.branch || ''
            });
        });

        // Add any employees found in attendance logs not in employees table
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
        const workbook = XLSX.utils.book_new();

        empMap.forEach((empInfo) => {
            let totalMinutes = 0;
            let daysPresent = 0;
            const records: Record<string, string>[] = [];

            // Complete calendar grid: Every single date in the period is included
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
                    // Day with no fingerprints / attendance: punch fields are left cleanly EMPTY
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
            XLSX.utils.sheet_add_json(worksheet, recordsWithStats, { origin: "A4" });

            XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
        });

        if (empMap.size === 0) {
            const emptySheet = XLSX.utils.json_to_sheet([{ 'Message': 'No employees or records found for this period' }]);
            XLSX.utils.book_append_sheet(workbook, emptySheet, "Attendance");
        }

        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="Attendance_${startDate}_to_${endDate}.xlsx"`
            }
        });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
