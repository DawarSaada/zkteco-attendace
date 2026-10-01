import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { loadDailyReportRows } from '@/lib/reports/source';

/**
 * GET /api/reports/daily?start=YYYY-MM-DD&end=YYYY-MM-DD&pin=…&branch=…
 *
 * Returns one row per employee per date for the range, with the engine's figures
 * (`lib/reports/source.ts`) overlaid on the legacy punch-log view. The overlay is
 * what keeps the grid complete: the engine only covers the days it has
 * recomputed, so reading it alone silently dropped every other day of history.
 *
 * `X-Report-Engine-Rows` / `X-Report-Derived-Rows` let the page say when part of
 * a range is still being served from the legacy view.
 */
export async function GET(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const start = searchParams.get('start');
        const end = searchParams.get('end');

        if (!start || !end) {
            return NextResponse.json({ error: 'Missing date range' }, { status: 400 });
        }

        const { rows, engineRows, legacyOnlyRows } = await loadDailyReportRows(supabase, {
            start,
            end,
            pin: searchParams.get('pin'),
            branch: searchParams.get('branch'),
        });

        return NextResponse.json(rows, {
            headers: {
                'X-Report-Engine-Rows': String(engineRows),
                'X-Report-Derived-Rows': String(legacyOnlyRows),
            },
        });
    } catch (error: unknown) {
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
