import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { formatPunchTime, formatTotalHours, calculateMinutes } from '@/lib/utils/formatTime';
import * as XLSX from 'xlsx';
import { DailyAttendanceSummary } from '@/types';

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

        let query = supabase
            .from('daily_attendance_summary')
            .select('*')
            .gte('punch_date', startDate)
            .lte('punch_date', endDate)
            .order('punch_date', { ascending: true })
            .order('pin', { ascending: true });

        if (pin && pin !== 'all') {
            query = query.eq('pin', pin);
        }
        if (branch && branch !== 'all') {
            query = query.eq('branch', branch);
        }

        const { data, error } = await query;

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const recordsList = (data || []) as DailyAttendanceSummary[];

        // Group rows by employee PIN (fallback to full_name)
        const groupedData = recordsList.reduce((acc: Record<string, {
            pin: string;
            name: string;
            department: string;
            branch: string;
            records: Record<string, string>[];
            totalMinutes: number;
            daysPresent: number;
        }>, row: DailyAttendanceSummary) => {
            const empKey = row.pin || row.full_name || 'unknown';
            const empName = row.full_name || `PIN ${row.pin}`;
            
            if (!acc[empKey]) {
                acc[empKey] = {
                    pin: row.pin,
                    name: empName,
                    department: row.department || '',
                    branch: row.branch || '',
                    records: [],
                    totalMinutes: 0,
                    daysPresent: 0
                };
            }

            const clockInFormatted = formatPunchTime(row.check_in);
            const clockOutFormatted = formatPunchTime(row.check_out);
            const totalHoursFormatted = formatTotalHours(row.check_in, row.check_out);
            const rowMinutes = calculateMinutes(row.check_in, row.check_out);

            acc[empKey].totalMinutes += rowMinutes;
            if (row.check_in) {
                acc[empKey].daysPresent += 1;
            }

            acc[empKey].records.push({
                'Date': row.punch_date,
                'Check In': clockInFormatted,
                'Check Out': clockOutFormatted,
                'Total Hours': totalHoursFormatted,
                'Device Name': row.device_name || '-',
                'Branch': row.branch || acc[empKey].branch || '-'
            });

            return acc;
        }, {});

        const workbook = XLSX.utils.book_new();

        Object.values(groupedData).forEach((empInfo) => {
            // Truncate and sanitize sheet name (max 31 characters for Excel)
            const rawSheetName = empInfo.name || `PIN_${empInfo.pin}`;
            const safeSheetName = rawSheetName.replace(/[\\/?*[\]:]/g, '').substring(0, 31) || `PIN_${empInfo.pin}`;

            const deptString = empInfo.department ? `, Department: ${empInfo.department}` : '';
            const branchString = empInfo.branch ? `, Branch: ${empInfo.branch}` : '';
            
            const headerData = [
                [`Start Date: ${startDate}    End Date: ${endDate}`],
                [`Employee ID: ${empInfo.pin}, Name: ${empInfo.name}${deptString}${branchString}`],
                [] // Spacer row
            ];

            const totalHrs = Math.floor(empInfo.totalMinutes / 60);
            const totalMins = empInfo.totalMinutes % 60;
            const formattedTotalHours = `${totalHrs}h ${totalMins}m`;

            const recordsWithStats = [
                ...empInfo.records,
                {
                    'Date': 'Summary Statistics',
                    'Check In': `Days Present: ${empInfo.daysPresent}`,
                    'Check Out': '',
                    'Total Hours': `Total: ${formattedTotalHours}`,
                    'Device Name': '',
                    'Branch': ''
                }
            ];

            const worksheet = (XLSX.utils.json_to_sheet as any)(recordsWithStats, { origin: "A4" });
            XLSX.utils.sheet_add_aoa(worksheet, headerData, { origin: "A1" });

            XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName);
        });

        if (Object.keys(groupedData).length === 0) {
            const emptySheet = XLSX.utils.json_to_sheet([{ 'Message': 'No records found for this period' }]);
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
