import { deliverEmail, type EmailAttachment } from '@/lib/mail/transport';
import type { ReportResult } from '@/lib/reports/engine';

export interface SendReportPackOptions {
  recipients: string[];
  report: ReportResult;
  attachments: EmailAttachment[];
}

/**
 * Dispatch a report-pack attachment (weekly exceptions, daily absence, …).
 * The body lists the totals the engine computed, so the email and the attachment
 * cannot tell different stories.
 */
export async function sendReportPackEmail({
  recipients,
  report,
  attachments,
}: SendReportPackOptions): Promise<{ success: boolean; messageId?: string; simulated?: boolean; error?: string }> {
  const subject = `📊 ${report.title}: ${report.from} to ${report.to}`;

  const totalsRows = Object.entries(report.totals)
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">${key.replace(/_/g, ' ')}</td><td style="font-weight:700;color:#0f172a;font-size:12px;">${value}</td></tr>`,
    )
    .join('');

  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#1e293b;margin:0;padding:24px;">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;max-width:600px;margin:0 auto;">
      <h1 style="font-size:18px;font-weight:700;color:#0f172a;margin:0 0 4px;">${report.title}</h1>
      <p style="font-size:13px;color:#64748b;margin:0 0 20px;">Period: ${report.from} to ${report.to}</p>
      <p>Hello,</p>
      <p>The scheduled report for this period is attached (${report.rowCount} row${report.rowCount === 1 ? '' : 's'}).</p>
      ${totalsRows ? `<table style="margin:16px 0;background:#f1f5f9;border-radius:12px;padding:12px;">${totalsRows}</table>` : ''}
      <p style="font-size:12px;color:#94a3b8;">Sent automatically by the Dawar Al-Saada attendance server.</p>
    </div>
  </body>
  </html>`;

  return deliverEmail({ recipients, subject, html, attachments });
}
