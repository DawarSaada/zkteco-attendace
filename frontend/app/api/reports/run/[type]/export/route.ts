import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { isReportType, runReport } from '@/lib/reports/service';
import {
    reportFileName,
    reportToCsv,
    reportToPdf,
    reportToXlsx,
} from '@/lib/reports/exporters';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CONTENT_TYPES: Record<string, string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv; charset=utf-8',
    pdf: 'application/pdf',
};

/**
 * GET /api/reports/run/<type>/export?format=xlsx|csv|pdf&from=…&to=…
 *
 * The Excel, CSV and PDF variants are all produced from the same `ReportResult`,
 * so they cannot diverge from each other or from the JSON endpoint.
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ type: string }> },
) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const { type } = await params;
        if (!isReportType(type)) {
            return NextResponse.json({ error: `Unknown report type: ${type}` }, { status: 404 });
        }

        const { searchParams } = new URL(request.url);
        const from = searchParams.get('from');
        const to = searchParams.get('to');
        const format = (searchParams.get('format') ?? 'xlsx').toLowerCase();

        if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
            return NextResponse.json(
                { error: 'from and to are required as YYYY-MM-DD (from <= to)' },
                { status: 400 },
            );
        }

        if (!CONTENT_TYPES[format]) {
            return NextResponse.json({ error: 'format must be xlsx, csv or pdf' }, { status: 400 });
        }

        const supabase = createAdminClient();
        const report = await runReport(supabase, {
            type,
            from,
            to,
            pin: searchParams.get('pin'),
            branch: searchParams.get('branch'),
        });

        let body: Buffer | Uint8Array;
        if (format === 'xlsx') body = reportToXlsx(report);
        else if (format === 'csv') body = Buffer.from(reportToCsv(report), 'utf8');
        else body = reportToPdf(report);

        return new NextResponse(body as unknown as BodyInit, {
            headers: {
                'Content-Type': CONTENT_TYPES[format],
                'Content-Disposition': `attachment; filename="${reportFileName(report, format)}"`,
                'Cache-Control': 'no-store',
                'X-Report-Rows': String(report.rowCount),
                'X-Report-Truncated': String(report.truncated),
            },
        });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
