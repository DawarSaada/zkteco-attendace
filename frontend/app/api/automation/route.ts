import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAuthUser, getErrorMessage } from '@/lib/auth-guard';
import { generateBranchReportBuffer } from '@/lib/reports/generateBranchReportBuffer';
import { sendReportEmail } from '@/lib/mail/sendReportEmail';
import { format, subMonths } from 'date-fns';

function calculatePayrollWindow(startDay: number = 26, endDay: number = 25) {
    const now = new Date();
    // Start date is the 26th of the previous month
    const prevMonth = subMonths(now, 1);
    const startYear = prevMonth.getFullYear();
    const startMonth = String(prevMonth.getMonth() + 1).padStart(2, '0');
    const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, '0')}`;

    // End date is the 25th of the current month
    const endYear = now.getFullYear();
    const endMonth = String(now.getMonth() + 1).padStart(2, '0');
    const endDate = `${endYear}-${endMonth}-${String(endDay).padStart(2, '0')}`;

    return { startDate, endDate };
}

export async function GET() {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();

        const [rulesRes, logsRes] = await Promise.all([
            supabase.from('report_automations').select('*').order('created_at', { ascending: false }),
            supabase.from('report_automation_logs').select('*').order('created_at', { ascending: false }).limit(30)
        ]);

        if (rulesRes.error && rulesRes.error.message.includes('schema cache')) {
            return NextResponse.json({
                rules: [],
                logs: [],
                warning: 'The report_automations table has not been created yet in Supabase. Please run the SQL schema.'
            });
        }

        return NextResponse.json({
            rules: rulesRes.data || [],
            logs: logsRes.data || []
        });
    } catch (err: unknown) {
        return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const body = await request.json();

        // 1. Instant Test Dispatch Action
        if (body.action === 'test_send') {
            const { branch, recipients, cycle_start_day = 26, cycle_end_day = 25, automation_id } = body;

            if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
                return NextResponse.json({ error: 'Please specify at least one recipient email.' }, { status: 400 });
            }

            const { startDate, endDate } = calculatePayrollWindow(cycle_start_day, cycle_end_day);
            const reportResult = await generateBranchReportBuffer(startDate, endDate, branch);
            const mailResult = await sendReportEmail({ recipients, reportResult });

            // Log execution in database
            await supabase.from('report_automation_logs').insert([{
                automation_id: automation_id || null,
                branch: branch || 'all',
                period_start: startDate,
                period_end: endDate,
                recipients,
                status: mailResult.success ? 'SUCCESS' : 'FAILED',
                error_message: mailResult.error || (mailResult.simulated ? 'Simulated dispatch (SMTP not configured)' : null)
            }]);

            if (automation_id) {
                await supabase.from('report_automations').update({
                    last_run_at: new Date().toISOString(),
                    last_run_status: mailResult.success ? 'SUCCESS' : 'FAILED'
                }).eq('id', automation_id);
            }

            if (!mailResult.success) {
                return NextResponse.json({
                    success: false,
                    error: mailResult.error || 'Failed to dispatch email via Resend/SMTP'
                }, { status: 400 });
            }

            return NextResponse.json({
                success: true,
                simulated: mailResult.simulated,
                message: mailResult.simulated
                    ? 'Test report generated! (Simulated mode: Add RESEND_API_KEY in Vercel to send live emails)'
                    : `Report dispatched successfully to ${recipients.join(', ')}`,
                startDate,
                endDate,
                totalEmployees: reportResult.totalEmployees
            });
        }

        // 2. Create / Upsert Automation Rule
        const {
            id,
            branch,
            recipient_emails,
            cycle_start_day = 26,
            cycle_end_day = 25,
            dispatch_day = 26,
            dispatch_time = '08:00:00',
            report_format = 'both',
            is_active = true
        } = body;

        if (!branch || !recipient_emails || !Array.isArray(recipient_emails) || recipient_emails.length === 0) {
            return NextResponse.json({ error: 'Missing branch or recipient emails list' }, { status: 400 });
        }

        const payload: Record<string, any> = {
            branch,
            recipient_emails,
            cycle_start_day: Number(cycle_start_day),
            cycle_end_day: Number(cycle_end_day),
            dispatch_day: Number(dispatch_day),
            dispatch_time,
            report_format,
            is_active
        };

        if (id) {
            const { error } = await supabase.from('report_automations').update(payload).eq('id', id);
            if (error) throw error;
            return NextResponse.json({ success: true, message: 'Automation updated' });
        } else {
            const { data, error } = await supabase.from('report_automations').insert([payload]).select();
            if (error) throw error;
            return NextResponse.json({ success: true, data });
        }
    } catch (err: unknown) {
        return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const auth = await requireAuthUser();
    if (!auth.user) return auth.response!;

    try {
        const supabase = createAdminClient();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) return NextResponse.json({ error: 'Missing automation id' }, { status: 400 });

        const { error } = await supabase.from('report_automations').delete().eq('id', id);
        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (err: unknown) {
        return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
    }
}
