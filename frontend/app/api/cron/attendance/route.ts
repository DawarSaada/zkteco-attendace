import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { recomputeRange } from '@/lib/attendance/recompute';
import { addDays, toDateKey } from '@/lib/attendance/engine';

/**
 * Nightly attendance recompute.
 *
 * A nightly pass exists to catch two things the ingest hook cannot:
 *  - punches that arrived after their day's summary was last computed, and
 *  - the after-midnight half of a night shift, which belongs to the previous
 *    work date and so is (re)computed here too.
 *
 * Recomputing the last few days is cheap and idempotent.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    console.error('[Cron] CRON_SECRET is not set; refusing to run the attendance recompute.');
    return NextResponse.json(
      { error: 'Cron is not configured on this deployment.' },
      { status: 503 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized cron trigger' }, { status: 401 });
  }

  try {
    const to = toDateKey(new Date().toISOString());
    const from = addDays(to, -2);

    const supabase = createAdminClient();
    const result = await recomputeRange(supabase, { from, to });

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    console.error('[Cron] attendance recompute failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recompute failed' },
      { status: 500 },
    );
  }
}
