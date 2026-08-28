import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { generateBranchReportBuffer } from '@/lib/reports/generateBranchReportBuffer';
import { sendReportEmail } from '@/lib/mail/sendReportEmail';
import { format, subMonths } from 'date-fns';
import { ReportAutomation } from '@/types';

function calculatePayrollWindow(startDay: number = 26, endDay: number = 25) {
    const now = new Date();
    const prevMonth = subMonths(now, 1);
    const startYear = prevMonth.getFullYear();
    const startMonth = String(prevMonth.getMonth() + 1).padStart(2, '0');
    const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, '0')}`;

    const endYear = now.getFullYear();
    const endMonth = String(now.getMonth() + 1).padStart(2, '0');
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

        // 2. Fetch all active automation rules
        const { data: rulesData, error: rulesError } = await supabase
            .from('report_automations')
            .select('*')
            .eq('is_active', true);

        if (rulesError) throw rulesError;

        const rules = (rulesData || []) as ReportAutomation[];
        const results = [];

        // 3. Process each branch automation
        for (const rule of rules) {
            const { startDate, endDate } = calculatePayrollWindow(rule.cycle_start_day, rule.cycle_end_day);

            try {
                const reportResult = await generateBranchReportBuffer(startDate, endDate, rule.branch);
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
                    error_message: mailResult.error || (mailResult.simulated ? 'Simulated dispatch (SMTP credentials pending)' : null)
                }]);

                await supabase.from('report_automations').update({
                    last_run_at: new Date().toISOString(),
                    last_run_status: mailResult.success ? 'SUCCESS' : 'FAILED'
                }).eq('id', rule.id);

                results.push({
                    branch: rule.branch,
                    status: mailResult.success ? 'SUCCESS' : 'FAILED',
                    recipients: rule.recipient_emails,
                    startDate,
                    endDate
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
            totalProcessed: rules.length,
            timestamp: new Date().toISOString(),
            results
        });
    } catch (err: unknown) {
        console.error('[Monthly Reports Cron Global Error]', err);
        return NextResponse.json({
            error: err instanceof Error ? err.message : 'Cron failed'
        }, { status: 500 });
    }
}
