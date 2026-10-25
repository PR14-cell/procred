import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SentEmailRecord {
  to: string;
  subject: string;
  html: string;
  text?: string;
  sentAt: Date;
}

// In-memory array for test mode assertions
const mockSentEmails: SentEmailRecord[] = [];

export function getMockSentEmails(): SentEmailRecord[] {
  return [...mockSentEmails];
}

export function clearMockSentEmails(): void {
  mockSentEmails.length = 0;
}

let transporterInstance: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporterInstance) {
    return transporterInstance;
  }

  if (process.env.NODE_ENV === 'test') {
    // Return a mock transport that records messages
    transporterInstance = {
      sendMail: async (mailOptions: any) => {
        mockSentEmails.push({
          to: mailOptions.to,
          subject: mailOptions.subject,
          html: mailOptions.html,
          text: mailOptions.text,
          sentAt: new Date(),
        });
        return { messageId: `mock-${Date.now()}` };
      },
    } as unknown as Transporter;
    return transporterInstance;
  }

  // Real SMTP transport
  transporterInstance = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT) || 2525,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });

  return transporterInstance;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions) {
  try {
    const transporter = getTransporter();
    const fromAddress = process.env.SMTP_FROM || 'notifications@credentialing.local';
    
    const info = await transporter.sendMail({
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.subject,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EmailServiceError] Failed to send email:', error);
    return { success: false, error };
  }
}

// ============================================================
// HTML Email Templates
// ============================================================

export function buildCredentialExpirationEmail(params: {
  providerName: string;
  credentialTitle: string;
  identifier: string;
  expirationDate: string;
  daysRemaining: number;
  isExpired: boolean;
}): { subject: string; html: string } {
  const subject = params.isExpired
    ? `URGENT: ${params.credentialTitle} for ${params.providerName} has EXPIRED`
    : `Expiration Alert: ${params.credentialTitle} expires in ${params.daysRemaining} days`;

  const badgeColor = params.isExpired ? '#dc2626' : params.daysRemaining <= 30 ? '#ea580c' : '#ca8a04';
  const badgeText = params.isExpired ? 'EXPIRED' : `${params.daysRemaining} DAYS REMAINING`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 20px; }
    .badge { display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 700; color: #ffffff; background: ${badgeColor}; border-radius: 4px; }
    .body { padding: 24px; }
    .details { background: #f1f5f9; padding: 16px; border-radius: 6px; margin: 16px 0; }
    .footer { font-size: 12px; color: #64748b; padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 style="margin:0; font-size: 18px;">Provider Credentialing System</h2>
    </div>
    <div class="body">
      <div style="margin-bottom: 12px;">
        <span class="badge">${badgeText}</span>
      </div>
      <h3 style="margin: 0 0 16px 0;">Credential Expiration Notice</h3>
      <p>The following healthcare provider credential requires administrative review or renewal:</p>
      <div class="details">
        <p style="margin: 4px 0;"><strong>Provider:</strong> ${params.providerName}</p>
        <p style="margin: 4px 0;"><strong>Credential:</strong> ${params.credentialTitle}</p>
        <p style="margin: 4px 0;"><strong>Identifier:</strong> ${params.identifier}</p>
        <p style="margin: 4px 0;"><strong>Expiration Date:</strong> ${params.expirationDate}</p>
      </div>
      <p style="font-size: 14px; color: #475569;">Please log in to the Provider Credentialing portal to initiate verification, upload renewed documentation, or record source verification.</p>
    </div>
    <div class="footer">
      This is an automated notification from your internal Provider Credentialing & Payer Enrollment platform.
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}

export function buildRevalidationDueEmail(params: {
  providerName: string;
  payerName: string;
  revalidationDate: string;
  daysRemaining: number;
}): { subject: string; html: string } {
  const subject = `Payer Revalidation Alert: ${params.payerName} enrollment due in ${params.daysRemaining} days`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 20px; }
    .body { padding: 24px; }
    .details { background: #f1f5f9; padding: 16px; border-radius: 6px; margin: 16px 0; }
    .footer { font-size: 12px; color: #64748b; padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 style="margin:0; font-size: 18px;">Payer Enrollment Notification</h2>
    </div>
    <div class="body">
      <h3 style="margin: 0 0 16px 0;">Payer Revalidation Due Soon</h3>
      <p>An upcoming payer enrollment revalidation deadline requires action to maintain billing privileges:</p>
      <div class="details">
        <p style="margin: 4px 0;"><strong>Provider:</strong> ${params.providerName}</p>
        <p style="margin: 4px 0;"><strong>Payer:</strong> ${params.payerName}</p>
        <p style="margin: 4px 0;"><strong>Revalidation Date:</strong> ${params.revalidationDate}</p>
        <p style="margin: 4px 0;"><strong>Days Remaining:</strong> ${params.daysRemaining}</p>
      </div>
      <p style="font-size: 14px; color: #475569;">Please review the enrollment requirements and prepare any necessary revalidation forms or attestation documents.</p>
    </div>
    <div class="footer">
      This is an automated notification from your internal Provider Credentialing & Payer Enrollment platform.
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}

export function buildTaskAlertEmail(params: {
  title: string;
  description?: string;
  priority: string;
  dueDate: string;
  isOverdue: boolean;
}): { subject: string; html: string } {
  const subject = params.isOverdue
    ? `TASK OVERDUE: "${params.title}"`
    : `Task Due Reminder: "${params.title}"`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 20px; }
    .body { padding: 24px; }
    .details { background: #f1f5f9; padding: 16px; border-radius: 6px; margin: 16px 0; }
    .footer { font-size: 12px; color: #64748b; padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 style="margin:0; font-size: 18px;">Operational Task Reminder</h2>
    </div>
    <div class="body">
      <h3 style="margin: 0 0 16px 0;">${params.isOverdue ? 'Task Overdue Notice' : 'Task Due Notice'}</h3>
      <div class="details">
        <p style="margin: 4px 0;"><strong>Task:</strong> ${params.title}</p>
        <p style="margin: 4px 0;"><strong>Priority:</strong> <span style="text-transform: uppercase;">${params.priority}</span></p>
        <p style="margin: 4px 0;"><strong>Due Date:</strong> ${params.dueDate}</p>
        ${params.description ? `<p style="margin: 4px 0;"><strong>Details:</strong> ${params.description}</p>` : ''}
      </div>
      <p style="font-size: 14px; color: #475569;">Please visit your operational work queue to update task progress or mark it complete.</p>
    </div>
    <div class="footer">
      This is an automated notification from your internal Provider Credentialing & Payer Enrollment platform.
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}

export interface DailyDigestItem {
  type: string;
  title: string;
  detail: string;
  urgency: 'critical' | 'high' | 'medium';
}

export function buildDailyDigestEmail(params: {
  recipientName: string;
  items: DailyDigestItem[];
  dateString: string;
}): { subject: string; html: string } {
  const subject = `Daily Credentialing Digest - ${params.dateString} (${params.items.length} items requiring attention)`;

  const rows = params.items
    .map(
      (item) => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px; font-size: 12px; font-weight: bold; text-transform: uppercase; color: ${
        item.urgency === 'critical' ? '#dc2626' : item.urgency === 'high' ? '#ea580c' : '#475569'
      };">${item.urgency}</td>
      <td style="padding: 10px; font-weight: 600; font-size: 14px;">${item.title}</td>
      <td style="padding: 10px; font-size: 13px; color: #475569;">${item.detail}</td>
    </tr>
  `
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 20px; }
    .card { max-width: 650px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 20px; }
    .body { padding: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { text-align: left; background: #f1f5f9; padding: 8px 10px; font-size: 12px; text-transform: uppercase; color: #64748b; }
    .footer { font-size: 12px; color: #64748b; padding: 16px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 style="margin:0; font-size: 18px;">Provider Credentialing - Daily Operational Digest</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">${params.dateString}</p>
    </div>
    <div class="body">
      <p>Hello ${params.recipientName},</p>
      <p>Here is your operational summary of expiring credentials, due payer revalidations, and open tasks requiring attention today:</p>
      ${
        params.items.length > 0
          ? `
      <table>
        <thead>
          <tr>
            <th style="width: 15%;">Priority</th>
            <th style="width: 45%;">Item</th>
            <th style="width: 40%;">Status / Date</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      `
          : '<p style="color: #16a34a; font-weight: 500;">No pending items requiring immediate attention today. All clear!</p>'
      }
    </div>
    <div class="footer">
      Manage your notification settings in the portal under Notifications > Preferences.
    </div>
  </div>
</body>
</html>
  `.trim();

  return { subject, html };
}
