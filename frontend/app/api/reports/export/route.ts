import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';
import { DailyAttendanceSummary } from '@/types';

export async function GET(request: Request) {
    try {
        const authClient = await createClient();
        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (!user || authError) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

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
            .order('punch_date', { ascending: true });

        if (pin && pin !== 'all') {
            query = query.eq('pin', pin);
        }
        if (branch && branch !== 'all') {
            query = query.eq('branch', branch);
        }

        const { data, error } = await query;

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        const recordsList = (data || []) as DailyAttendanceSummary[];

        const groupedData = recordsList.reduce((acc: Record<string, { pin: string; name: string; department: string; branch: string; records: Record<string, string>[]; totalMinutes: number }>, row: DailyAttendanceSummary) => {
            const empName = row.full_name || row.pin;
            if (!acc[empName]) {
                acc[empName] = {
                    pin: row.pin,
                    name: empName,
                    department: row.department || '',
                    branch: row.branch || '',
                    records: [],
                    totalMinutes: 0
                };
            }
            
            const pDate = new Date(row.punch_date);
            const weekday = pDate.toLocaleDateString('en-US', { weekday: 'long' });
            
            let clockIn = '';
            let clockOut = '';
            let totalHours = '';

            if (row.check_in) {
                clockIn = new Date(row.check_in).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            }
            
            if (row.check_out && row.check_in && row.check_in !== row.check_out) {
                clockOut = new Date(row.check_out).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                const cIn = new Date(row.check_in).getTime();
                const cOut = new Date(row.check_out).getTime();
                const mins = Math.floor((cOut - cIn) / 60000);
                
                if (mins > 0) {
                    acc[empName].totalMinutes += mins;
                    const hrs = Math.floor(mins / 60);
                    const remainingMins = mins % 60;
                    totalHours = `${hrs.toString().padStart(2, '0')}:${remainingMins.toString().padStart(2, '0')}`;
                }
            }
            
            acc[empName].records.push({
                'Date': row.punch_date,
                'Weekday': weekday,
                'Timetable': '',
                'Check In': row.shift_start ? row.shift_start.substring(0, 5) : '00:00',
                'Check Out': row.shift_end ? row.shift_end.substring(0, 5) : '00:00',
                'Normal': '',
                'Break': '',
                'Work day': '1.0',
                'Clock In': clockIn,
                'Clock Out': clockOut,
                'Total Hours': totalHours,
                'Work Hours': '12:00',
                'Break Out': '',
                'Break In': ''
            });
            
            return acc;
        }, {});

        const workbook = XLSX.utils.book_new();

        Object.entries(groupedData).forEach(([empName, empInfo]) => {
            const safeSheetName = String(empName).substring(0, 31).replace(/[\\/?*[\]]/g, '');
            
            // Add Header rows
            const deptString = empInfo.department ? `, Department: ${empInfo.department}` : '';
            const branchString = empInfo.branch ? `, Branch: ${empInfo.branch}` : '';
            const headerData = [
                [`Start Date: ${startDate}  End Date: ${endDate}`],
                [`Employee ID: ${empInfo.pin}, Name: ${empInfo.name}${deptString}${branchString}`],
                [] // Empty spacer row before table
            ];

            // Calculate statistics
            const totalHrs = Math.floor(empInfo.totalMinutes / 60);
            const totalMins = empInfo.totalMinutes % 60;
            const formattedTotal = `${totalHrs.toString().padStart(2, '0')}:${totalMins.toString().padStart(2, '0')}`;
            
            const recordsWithStats = [
                ...empInfo.records,
                {
                    'Date': 'Statistics',
                    'Total Hours': formattedTotal
                }
            ];

            const worksheet = (XLSX.utils.json_to_sheet as any)(recordsWithStats, { origin: "A4" });
            XLSX.utils.sheet_add_aoa(worksheet, headerData, { origin: "A1" });
            
            XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName || 'Unknown');
        });

        if (Object.keys(groupedData).length === 0) {
            const emptySheet = XLSX.utils.json_to_sheet([{'Message': 'No records found for this period'}]);
            XLSX.utils.book_append_sheet(workbook, emptySheet, "Attendance");
        }

        const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="Attendance_${startDate}_to_${endDate}.xlsx"`
            }
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
    }
}
