import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { isReportType, runReport } from '@/lib/reports/service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/reports/run/<type>?from=…&to=…&pin=…&branch=… */
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

        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const from = searchParams.get('from');
        const to = searchParams.get('to');

        if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
            return NextResponse.json(
                { error: 'from and to are required as YYYY-MM-DD (from <= to)' },
                { status: 400 },
            );
        }

        const report = await runReport(supabase, {
            type,
            from,
            to,
            pin: searchParams.get('pin'),
            branch: searchParams.get('branch'),
        });

        return NextResponse.json(report);
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
