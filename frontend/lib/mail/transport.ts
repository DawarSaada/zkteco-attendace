import { Resend } from 'resend';
import nodemailer from 'nodemailer';

/**
 * One delivery path for every outbound email, so the scheduled-report jobs do not
 * each re-implement the Resend → SMTP → simulated fallback chain (and drift).
 */

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface DeliverEmailOptions {
  recipients: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface DeliverEmailResult {
  success: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

function getResendFromAddress(): string {
  const raw = (process.env.RESEND_FROM || '').trim();
  if (!raw) return 'Dawar Al-Saada Attendance <attendance@techydez.com.pk>';
  if (raw.includes('<') && raw.includes('>')) return raw;
  if (raw.includes('@')) return `Dawar Al-Saada Attendance <${raw}>`;
  return `${raw} <attendance@techydez.com.pk>`;
}

export async function deliverEmail({
  recipients,
  subject,
  html,
  attachments = [],
}: DeliverEmailOptions): Promise<DeliverEmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const response = await resend.emails.send({
        from: getResendFromAddress(),
        to: recipients,
        subject,
        html,
        attachments: attachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
        })),
      });

      if (response.error) {
        console.error('[Resend Error]', response.error);
        return { success: false, error: response.error.message || 'Resend delivery failed' };
      }

      return { success: true, messageId: response.data?.id };
    } catch (error: unknown) {
      console.error('[Resend Exception]', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown Resend error',
      };
    }
  }

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const port = Number(process.env.SMTP_PORT) || 587;
      const fromAddress = process.env.SMTP_FROM || `Dawar Al-Saada Attendance <${smtpUser}>`;

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const info = await transporter.sendMail({
        from: fromAddress,
        to: recipients.join(', '),
        subject,
        html,
        attachments,
      });

      return { success: true, messageId: info.messageId };
    } catch (error: unknown) {
      console.error('[SMTP Error]', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown SMTP dispatch error',
      };
    }
  }

  console.warn(
    `[Mail Dispatch] No RESEND_API_KEY or SMTP credentials configured. Simulated dispatch to ${recipients.join(', ')}`,
  );
  return { success: true, simulated: true, messageId: `simulated_${Date.now()}` };
}
