import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

export async function GET(request: Request) {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || new Date().toISOString().split('T')[0];
    const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('daily_attendance_summary')
        .select('*')
        .gte('punch_date', startDate)
        .lte('punch_date', endDate)
        .order('punch_date', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const groupedData = data.reduce((acc: any, row: any) => {
        const empName = row.full_name || row.pin;
        if (!acc[empName]) acc[empName] = [];
        
        acc[empName].push({
            'Date': row.punch_date,
            'Check In': row.check_in ? new Date(row.check_in).toLocaleTimeString() : '-',
            'Check Out': row.check_out ? new Date(row.check_out).toLocaleTimeString() : '-',
            'Total Punches': row.total_punches
        });
        
        return acc;
    }, {});

    const workbook = XLSX.utils.book_new();

    Object.entries(groupedData).forEach(([empName, records]) => {
        // Excel sheet names cannot exceed 31 characters and shouldn't have illegal chars
        const safeSheetName = String(empName).substring(0, 31).replace(/[\\/?*[\]]/g, '');
        const worksheet = XLSX.utils.json_to_sheet(records as any[]);
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
}
