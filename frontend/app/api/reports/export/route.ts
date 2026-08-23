import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || new Date().toISOString().split('T')[0];
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('daily_attendance_summary')
        .select(`
            *,
            employees (
                full_name,
                department
            )
        `)
        .gte('punch_date', startDate)
        .lte('punch_date', endDate)
        .order('punch_date', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const formattedData = data.map((row: any) => ({
        'PIN': row.pin,
        'Name': row.employees?.full_name || 'Unknown',
        'Department': row.employees?.department || '-',
        'Date': row.punch_date,
        'Check In': row.check_in ? new Date(row.check_in).toLocaleTimeString() : '-',
        'Check Out': row.check_out ? new Date(row.check_out).toLocaleTimeString() : '-',
        'Total Punches': row.total_punches
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="Attendance_${startDate}_to_${endDate}.xlsx"`
        }
    });
}
