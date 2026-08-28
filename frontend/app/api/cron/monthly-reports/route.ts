import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { generateBranchReportBuffer } from '@/lib/reports/generateBranchReportBuffer';
import { sendReportEmail } from '@/lib/mail/sendReportEmail';
import { subMonths } from 'date-fns';
import { ReportAutomation } from '@/types';

function getSaudiDateInfo() {
    // Saudi Arabia is AST (UTC+3)
    const now = new Date();
    const saudiTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const dayOfMonth = saudiTime.getUTCDate();
    const formatted = saudiTime.toISOString().substring(0, 19).replace('T', ' ') + ' (AST / UTC+3)';
    return { now, saudiTime, dayOfMonth, formatted };
}

function calculatePayrollWindow(startDay: number = 26, endDay: number = 25) {
    const now = new Date();
    // Use Saudi time for month calculation
    const saudiNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const prevMonth = subMonths(saudiNow, 1);
    const startYear = prevMonth.getFullYear();
    const startMonth = String(prevMonth.getMonth() + 1).padStart(2, '0');
    const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, '0')}`;

    const endYear = saudiNow.getFullYear();
    const endMonth = String(saudiNow.getMonth() + 1).padStart(2, '0');
    const endDate = `${endYear}-${endMonth}-${String(endDay).padStart(2, '0')}`;

    return { startDate, endDate };
}

export async function GET(request: Request) {
    // 1. Verify Authorization Header for Vercel Cron or secret query
    const { searchParams } = new URL(request.url);
    const authHeader = request.headers.get('authorization');
    const secret = process.env.CRON_SECRET;

    if (secret && authHeader !== `Bearer ${secret}` && searchParams.get('secret') !== secret) {
        return NextResponse.json({ error: 'Unauthorized cron trigger' }, { status: 401 });
    }

    try {
        const supabase = createAdminClient();
        const { dayOfMonth: currentSaudiDay, formatted: saudiTimestamp } = getSaudiDateInfo();
        const forceAll = searchParams.get('force') === 'true';

        // 2. Fetch all active automation rules
        const { data: rulesData, error: rulesError } = await supabase
            .from('report_automations')
            .select('*')
            .eq('is_active', true);

        if (rulesError) throw rulesError;

        const rules = (rulesData || []) as ReportAutomation[];
        
        // Filter rules that match today's date in Saudi Arabia (unless ?force=true)
        const eligibleRules = forceAll 
            ? rules 
            : rules.filter(r => (r.dispatch_day || 26) === currentSaudiDay);

        const results = [];

        // 3. Process each eligible branch automation
        for (const rule of eligibleRules) {
            const { startDate, endDate } = calculatePayrollWindow(rule.cycle_start_day, rule.cycle_end_day);

            try {
                const reportResult = await generateBranchReportBuffer(startDate, endDate, rule.branch, rule.report_format || 'both');
                const mailResult = await sendReportEmail({
                    recipients: rule.recipient_emails,
                    reportResult
                });

                // Log result
                await supabase.from('report_automation_logs').insert([{
                    automation_id: rule.id,
                    branch: rule.branch,
                    period_start: startDate,
                    period_end: endDate,
                    recipients: rule.recipient_emails,
                    status: mailResult.success ? 'SUCCESS' : 'FAILED',
                    error_message: mailResult.error || (mailResult.simulated ? 'Simulated dispatch (SMTP/Resend credentials pending)' : null)
                }]);

                await supabase.from('report_automations').update({
                    last_run_at: new Date().toISOString(),
                    last_run_status: mailResult.success ? 'SUCCESS' : 'FAILED'
                }).eq('id', rule.id);

                results.push({
                    branch: rule.branch,
                    dispatch_day: rule.dispatch_day || 26,
                    status: mailResult.success ? 'SUCCESS' : 'FAILED',
                    recipients: rule.recipient_emails,
                    startDate,
                    endDate,
                    format: rule.report_format || 'both'
                });
            } catch (ruleErr: unknown) {
                console.error(`[Cron Error on rule ${rule.id} (${rule.branch})]`, ruleErr);
                results.push({
                    branch: rule.branch,
                    status: 'FAILED',
                    error: ruleErr instanceof Error ? ruleErr.message : 'Unknown error'
                });
            }
        }

        return NextResponse.json({
            success: true,
            saudiDate: saudiTimestamp,
            currentSaudiDay,
            totalActiveRules: rules.length,
            totalProcessedToday: eligibleRules.length,
            results
        });
    } catch (err: unknown) {
        console.error('[Monthly Reports Cron Global Error]', err);
        return NextResponse.json({
            error: err instanceof Error ? err.message : 'Cron failed'
        }, { status: 500 });
    }
}
