import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { GeneratedReportResult } from '@/lib/reports/generateBranchReportBuffer';

interface SendReportOptions {
    recipients: string[];
    reportResult: GeneratedReportResult;
}

function getResendFromAddress(): string {
    const raw = (process.env.RESEND_FROM || '').trim();
    if (!raw) {
        return 'Dawar Al-Saada <onboarding@resend.dev>';
    }
    if (raw.includes('<') && raw.includes('>')) {
        return raw;
    }
    if (raw.includes('@')) {
        return `Dawar Al-Saada <${raw}>`;
    }
    return `${raw} <onboarding@resend.dev>`;
}

export async function sendReportEmail({ recipients, reportResult }: SendReportOptions): Promise<{ success: boolean; messageId?: string; simulated?: boolean; error?: string }> {
    const {
        excelBuffer,
        excelFileName,
        pdfBuffer,
        pdfFileName,
        branchName,
        startDate,
        endDate,
        reportFormat,
        totalEmployees,
        daysPresentCount,
        totalHoursFormatted
    } = reportResult;

    const resendApiKey = process.env.RESEND_API_KEY;
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    const subject = `📊 Monthly Attendance Report: ${branchName} (${startDate} to ${endDate})`;
    
    // Build attachments matching the selected format
    const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [];
    if (excelBuffer && excelFileName) {
        attachments.push({
            filename: excelFileName,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
    }
    if (pdfBuffer && pdfFileName) {
        attachments.push({
            filename: pdfFileName,
            content: pdfBuffer,
            contentType: 'application/pdf'
        });
    }

    const formatDescription = reportFormat === 'pdf'
        ? 'a 1-page-per-employee PDF document'
        : reportFormat === 'excel'
        ? 'an Excel spreadsheet'
        : 'both an Excel spreadsheet and a 1-page-per-employee PDF document';

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
            .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            .brand { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #3b82f6; padding-bottom: 16px; margin-bottom: 24px; }
            .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; }
            .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
            .stat-box { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0; background-color: #f1f5f9; padding: 16px; border-radius: 12px; }
            .stat-item { text-align: center; }
            .stat-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; }
            .stat-val { font-size: 18px; font-weight: 800; color: #0f172a; margin-top: 4px; }
            .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="brand">
                <div>
                    <h1 class="title">Dawar Al-Saada Attendance System</h1>
                    <p class="subtitle">Automated Monthly Branch Timecard Dispatch</p>
                </div>
            </div>

            <p>Hello,</p>
            <p>Please find attached the automated attendance and timecard report for <strong>${branchName}</strong> covering the payroll cycle from <strong>${startDate}</strong> to <strong>${endDate}</strong>.</p>

            <div class="stat-box">
                <div class="stat-item">
                    <div class="stat-label">Employees</div>
                    <div class="stat-val">${totalEmployees}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Days Present</div>
                    <div class="stat-val">${daysPresentCount}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Total Duration</div>
                    <div class="stat-val">${totalHoursFormatted}</div>
                </div>
            </div>

            <p>The complete day-by-day attendance records with check-in, check-out, shifts, and timestamps have been attached to this email as ${formatDescription}.</p>

            <div class="footer">
                <p>Sent automatically by Dawar Al-Saada BioTime Management Server • Port 8088</p>
            </div>
        </div>
    </body>
    </html>
    `;

    // 1. Prioritize Resend API if RESEND_API_KEY is provided
    if (resendApiKey) {
        try {
            const resend = new Resend(resendApiKey);
            const fromAddress = getResendFromAddress();

            const response = await resend.emails.send({
                from: fromAddress,
                to: recipients,
                subject,
                html: htmlContent,
                attachments: attachments.map(a => ({
                    filename: a.filename,
                    content: a.content
                }))
            });

            if (response.error) {
                console.error('[Resend Error]', response.error);
                return {
                    success: false,
                    error: response.error.message || 'Resend delivery failed'
                };
            }

            return {
                success: true,
                messageId: response.data?.id
            };
        } catch (err: unknown) {
            console.error('[Resend Exception]', err);
            return {
                success: false,
                error: err instanceof Error ? err.message : 'Unknown Resend error'
            };
        }
    }

    // 2. Fallback to standard SMTP if SMTP_HOST is configured
    if (smtpHost && smtpUser && smtpPass) {
        try {
            const port = Number(process.env.SMTP_PORT) || 587;
            const fromAddress = process.env.SMTP_FROM || `Dawar Al-Saada Attendance <${smtpUser}>`;

            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port,
                secure: port === 465,
                auth: { user: smtpUser, pass: smtpPass }
            });

            const info = await transporter.sendMail({
                from: fromAddress,
                to: recipients.join(', '),
                subject,
                html: htmlContent,
                attachments
            });

            return {
                success: true,
                messageId: info.messageId
            };
        } catch (err: unknown) {
            console.error('[SMTP Error]', err);
            return {
                success: false,
                error: err instanceof Error ? err.message : 'Unknown SMTP dispatch error'
            };
        }
    }

    // 3. Fallback to Simulated Mode if neither Resend nor SMTP is configured yet
    console.warn(`[Mail Dispatch] No RESEND_API_KEY or SMTP credentials configured. Simulated dispatch for ${branchName} to ${recipients.join(', ')}`);
    return {
        success: true,
        simulated: true,
        messageId: `simulated_${Date.now()}`
    };
}
