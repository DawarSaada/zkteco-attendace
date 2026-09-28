import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { generateBranchReportBuffer } from '@/lib/reports/generateBranchReportBuffer';
import { sendReportEmail } from '@/lib/mail/sendReportEmail';
import { sendReportPackEmail } from '@/lib/mail/sendReportPackEmail';
import { isReportType, runReport } from '@/lib/reports/service';
import { reportFileName, reportToPdf, reportToXlsx } from '@/lib/reports/exporters';
import { isDue, periodFor, saudiNow } from '@/lib/reports/schedule';
import type { EmailAttachment } from '@/lib/mail/transport';
import { subMonths } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Scheduled report dispatch.
 *
 * The cron runs hourly and this handler asks `isDue()` which rules are due, so
 * each rule's own `dispatch_time` is honoured (M4) instead of the job being
 * pinned to one hour.
 *
 * Two dispatch paths coexist on purpose:
 *  - a monthly **timecard** rule keeps the original day-by-day branch grid
 *    (Excel + per-employee PDF) that customers already receive — changing that
 *    silently would be a regression, not an improvement;
 *  - every other combination uses the report-pack engine.
 */

function getSaudiDateInfo() {
    const now = new Date();
    const saudiTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const dayOfMonth = saudiTime.getUTCDate();
    const formatted = saudiTime.toISOString().substring(0, 19).replace('T', ' ') + ' (AST / UTC+3)';
    return { now, saudiTime, dayOfMonth, formatted };
}

function calculatePayrollWindow(startDay: number = 26, endDay: number = 25) {
    const now = new Date();
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

interface AutomationRow {
    id: string;
    branch: string;
    recipient_emails: string[];
    cycle_start_day?: number | null;
    cycle_end_day?: number | null;
    dispatch_day?: number | null;
    dispatch_time?: string | null;
    report_format?: string | null;
    report_type?: string | null;
    cadence?: string | null;
    last_run_at?: string | null;
}

async function record(
    supabase: SupabaseClient,
    rule: AutomationRow,
    period: { startDate: string; endDate: string },
    mailResult: { success: boolean; simulated?: boolean; error?: string },
    extra: Record<string, unknown>,
) {
    await supabase.from('report_automation_logs').insert([
        {
            automation_id: rule.id,
            branch: rule.branch,
            period_start: period.startDate,
            period_end: period.endDate,
            recipients: rule.recipient_emails,
            status: mailResult.success ? 'SUCCESS' : 'FAILED',
            error_message:
                mailResult.error ||
                (mailResult.simulated ? 'Simulated dispatch (SMTP/Resend credentials pending)' : null),
        },
    ]);

    await supabase
        .from('report_automations')
        .update({
            last_run_at: new Date().toISOString(),
            last_run_status: mailResult.success ? 'SUCCESS' : 'FAILED',
        })
        .eq('id', rule.id);

    return {
        branch: rule.branch,
        report_type: rule.report_type ?? 'timecard',
        cadence: rule.cadence ?? 'monthly',
        status: mailResult.success ? 'SUCCESS' : 'FAILED',
        recipients: rule.recipient_emails,
        ...period,
        ...extra,
    };
}

export async function GET(request: Request) {
    // 1. The cron secret is MANDATORY. Vercel Cron sends
    //    `Authorization: Bearer $CRON_SECRET` automatically.
    const { searchParams } = new URL(request.url);
    const secret = process.env.CRON_SECRET?.trim();

    if (!secret) {
        console.error('[Cron] CRON_SECRET is not set; refusing to run the report dispatch job (B8).');
        return NextResponse.json(
            { error: 'Cron is not configured on this deployment.' },
            { status: 503 },
        );
    }

    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized cron trigger' }, { status: 401 });
    }

    try {
        const supabase = createAdminClient();
        const { formatted: saudiTimestamp } = getSaudiDateInfo();
        const now = saudiNow();
        const forceAll = searchParams.get('force') === 'true';

        const { data: rulesData, error: rulesError } = await supabase
            .from('report_automations')
            .select('*')
            .eq('is_active', true);

        if (rulesError) throw rulesError;

        const rules = (rulesData || []) as AutomationRow[];
        const eligibleRules = forceAll ? rules : rules.filter((rule) => isDue(rule, now));

        const results: Record<string, unknown>[] = [];

        for (const rule of eligibleRules) {
            const cadence = rule.cadence ?? 'monthly';
            const reportType = rule.report_type ?? 'timecard';
            const format = (rule.report_format ?? 'both') as 'excel' | 'pdf' | 'both';

            try {
                // --- Legacy monthly timecard: the day-by-day branch grid ---
                if (cadence === 'monthly' && (!reportType || reportType === 'timecard')) {
                    const { startDate, endDate } = calculatePayrollWindow(
                        rule.cycle_start_day ?? 26,
                        rule.cycle_end_day ?? 25,
                    );
                    const reportResult = await generateBranchReportBuffer(
                        startDate,
                        endDate,
                        rule.branch,
                        format,
                    );
                    const mailResult = await sendReportEmail({
                        recipients: rule.recipient_emails,
                        reportResult,
                    });

                    results.push(
                        await record(
                            supabase,
                            rule,
                            { startDate, endDate },
                            mailResult,
                            { dispatch_day: rule.dispatch_day ?? 26, format },
                        ),
                    );
                    continue;
                }

                // --- Report-pack dispatch for any other cadence/type ---
                if (!isReportType(reportType)) {
                    results.push({
                        branch: rule.branch,
                        status: 'FAILED',
                        error: `Unknown report_type: ${reportType}`,
                    });
                    continue;
                }

                const { from, to } = periodFor(rule, now);
                const report = await runReport(supabase, {
                    type: reportType,
                    from,
                    to,
                    branch: rule.branch,
                });

                const attachments: EmailAttachment[] = [];
                if (format !== 'pdf') {
                    attachments.push({
                        filename: reportFileName(report, 'xlsx'),
                        content: reportToXlsx(report),
                        contentType:
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    });
                }
                if (format !== 'excel') {
                    attachments.push({
                        filename: reportFileName(report, 'pdf'),
                        content: Buffer.from(reportToPdf(report)),
                        contentType: 'application/pdf',
                    });
                }
                if (attachments.length === 0) {
                    attachments.push({
                        filename: reportFileName(report, 'xlsx'),
                        content: reportToXlsx(report),
                        contentType:
                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    });
                }

                const mailResult = await sendReportPackEmail({
                    recipients: rule.recipient_emails,
                    report,
                    attachments,
                });

                results.push(
                    await record(
                        supabase,
                        rule,
                        { startDate: from, endDate: to },
                        mailResult,
                        { rows: report.rowCount, format },
                    ),
                );
            } catch (ruleErr: unknown) {
                console.error(`[Cron Error on rule ${rule.id} (${rule.branch})]`, ruleErr);
                results.push({
                    branch: rule.branch,
                    status: 'FAILED',
                    error: ruleErr instanceof Error ? ruleErr.message : 'Unknown error',
                });
            }
        }

        return NextResponse.json({
            success: true,
            saudiDate: saudiTimestamp,
            saudiHour: now.hour,
            totalActiveRules: rules.length,
            dueNow: eligibleRules.length,
            results,
        });
    } catch (err: unknown) {
        console.error('[Report Dispatch Cron Global Error]', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Cron failed' },
            { status: 500 },
        );
    }
}
