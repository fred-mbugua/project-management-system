// ══════════════════════════════════════════════════════════════════════
// Universal Email Service with Attachment & Template Support
// ══════════════════════════════════════════════════════════════════════

import nodemailer, { Transporter } from 'nodemailer';
import logger from '../utils/logger';

const emailLogger = logger.child('EmailService');

export interface EmailAttachment {
  filename: string;
  content?: any;
  path?: string;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export class EmailService {
  private transporter: Transporter | null = null;
  private isConfigured: boolean = false;

  constructor() {
    this.initTransporter();
  }

  private initTransporter(): void {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    const isDummy = !user || user.includes('your_email') || !pass || pass.includes('your_email');

    if (host && user && pass && !isDummy) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
      });
      this.isConfigured = true;
      emailLogger.info('SMTP transporter configured successfully', { host, port, user });
    } else {
      this.isConfigured = false;
      emailLogger.info('SMTP not configured in .env. Outbound emails will be logged for development review.');
    }
  }

  /**
   * Send an email with optional attachments
   */
  async sendEmail(options: SendEmailOptions): Promise<boolean> {
    const defaultFromName = process.env.APP_NAME || 'Free Style Code Technologies';
    const defaultFromEmail = process.env.SMTP_FROM || 'billing@freestylecodetechnologies.com';
    const from = `"${options.fromName || defaultFromName}" <${defaultFromEmail}>`;

    if (!this.isConfigured || !this.transporter) {
      emailLogger.info('📨 [EMAIL SIMULATED / DEV MODE]', {
        to: options.to,
        from,
        subject: options.subject,
        attachmentsCount: options.attachments?.length || 0,
        attachmentNames: options.attachments?.map((a) => a.filename) || [],
      });
      return true;
    }

    try {
      const info = await this.transporter.sendMail({
        from,
        to: options.to,
        replyTo: options.replyTo || defaultFromEmail,
        subject: options.subject,
        text: options.text || '',
        html: options.html,
        attachments: options.attachments,
      });

      emailLogger.info('Email dispatched successfully', {
        messageId: info.messageId,
        to: options.to,
        subject: options.subject,
      });
      return true;
    } catch (error: any) {
      emailLogger.error('Failed to send email', {
        to: options.to,
        subject: options.subject,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Compose modern HTML email for recurring / auto-generated invoice
   */
  generateInvoiceEmailHtml(params: {
    tenantName: string;
    clientName: string;
    invoiceNumber: string;
    totalAmountFormatted: string;
    dueDateFormatted: string;
    paymentUrl: string;
    itemsSummary?: string;
  }): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 0; }
    .email-container { max-width: 600px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .email-header { background: #4f46e5; color: #ffffff; padding: 32px 24px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .email-header p { margin: 6px 0 0 0; opacity: 0.9; font-size: 14px; }
    .email-body { padding: 32px 24px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
    .info-box { background: #f1f5f9; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #64748b; }
    .info-value { font-weight: 700; color: #0f172a; }
    .btn-container { text-align: center; margin: 32px 0 24px 0; }
    .pay-btn { display: inline-block; background: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25); }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>${this.escape(params.tenantName)}</h1>
      <p>Official Invoice &bull; ${this.escape(params.invoiceNumber)}</p>
    </div>
    <div class="email-body">
      <div class="greeting">Dear ${this.escape(params.clientName)},</div>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Your recurring service maintenance invoice <strong>${this.escape(params.invoiceNumber)}</strong> has been generated and is ready for payment. 
        A PDF copy of this invoice is attached to this email for your records.
      </p>

      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Invoice Number:</span>
          <span class="info-value">${this.escape(params.invoiceNumber)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Due Date:</span>
          <span class="info-value">${this.escape(params.dueDateFormatted)}</span>
        </div>
        <div class="info-row" style="border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 8px;">
          <span class="info-label" style="font-weight: 700;">Total Payable:</span>
          <span class="info-value" style="font-size: 18px; color: #4f46e5;">${this.escape(params.totalAmountFormatted)}</span>
        </div>
      </div>

      <div class="btn-container">
        <a href="${params.paymentUrl}" class="pay-btn" target="_blank">Pay Invoice Online (M-Pesa / Card) &rarr;</a>
      </div>

      <p style="font-size: 13px; color: #64748b; text-align: center;">
        Or copy and paste this link in your browser:<br>
        <a href="${params.paymentUrl}" style="color: #4f46e5; word-break: break-all;">${params.paymentUrl}</a>
      </p>
    </div>
    <div class="email-footer">
      This is an automated commercial invoice sent by ${this.escape(params.tenantName)}.<br>
      Please do not reply directly to this email. For billing inquiries, contact your account manager.
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Compose modern HTML email for payment receipt
   */
  generateReceiptEmailHtml(params: {
    tenantName: string;
    clientName: string;
    receiptNumber: string;
    invoiceNumber: string;
    amountPaidFormatted: string;
    paymentMethod: string;
    paymentReference: string;
    paymentDateFormatted: string;
    receiptDownloadUrl?: string;
  }): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 0; }
    .email-container { max-width: 600px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .email-header { background: #059669; color: #ffffff; padding: 32px 24px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .email-header p { margin: 6px 0 0 0; opacity: 0.9; font-size: 14px; }
    .email-body { padding: 32px 24px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
    .info-box { background: #f0fdf4; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #bbf7d0; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #166534; }
    .info-value { font-weight: 700; color: #14532d; }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>Payment Received &bull; Thank You!</h1>
      <p>${this.escape(params.tenantName)} &bull; Receipt ${this.escape(params.receiptNumber)}</p>
    </div>
    <div class="email-body">
      <div class="greeting">Dear ${this.escape(params.clientName)},</div>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        We have successfully received and processed your payment of <strong>${this.escape(params.amountPaidFormatted)}</strong> for invoice <strong>${this.escape(params.invoiceNumber)}</strong>. 
        Your official receipt has been attached to this email.
      </p>

      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Receipt Number:</span>
          <span class="info-value">${this.escape(params.receiptNumber)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Invoice Settled:</span>
          <span class="info-value">${this.escape(params.invoiceNumber)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Payment Date:</span>
          <span class="info-value">${this.escape(params.paymentDateFormatted)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Payment Method:</span>
          <span class="info-value">${this.escape(params.paymentMethod)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Transaction Reference:</span>
          <span class="info-value">${this.escape(params.paymentReference)}</span>
        </div>
        <div class="info-row" style="border-top: 1px solid #86efac; padding-top: 8px; margin-top: 8px;">
          <span class="info-label" style="font-weight: 700;">Amount Settled:</span>
          <span class="info-value" style="font-size: 18px; color: #059669;">${this.escape(params.amountPaidFormatted)}</span>
        </div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
        Thank you for your ongoing partnership. Your service contract and maintenance remain fully active and supported.
      </p>
    </div>
    <div class="email-footer">
      Official Payment Receipt issued by ${this.escape(params.tenantName)}.<br>
      For any billing queries, contact accounts or your account representative.
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Compose modern HTML email for 3-day subscription expiration reminders (sent once per day)
   */
  generateSubscriptionReminderEmailHtml(params: {
    tenantName: string;
    recipientName: string;
    planName: string;
    daysRemaining: number;
    expiryDateFormatted: string;
    amountFormatted: string;
    paymentUrl: string;
    paymentInstructions?: string;
  }): string {
    const isLastDay = params.daysRemaining <= 1;
    const badgeColor = isLastDay ? '#dc2626' : (params.daysRemaining === 2 ? '#ea580c' : '#d97706');
    const badgeBg = isLastDay ? '#fef2f2' : (params.daysRemaining === 2 ? '#fff7ed' : '#fffbeb');
    const badgeBorder = isLastDay ? '#fca5a5' : (params.daysRemaining === 2 ? '#fdba74' : '#fde68a');
    const headerTitle = isLastDay
      ? '⚠️ Urgent: Subscription Expires Tomorrow / Today'
      : `Reminder: Subscription Expires in ${params.daysRemaining} Days`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 0; }
    .email-container { max-width: 620px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .email-header { background: ${badgeColor}; color: #ffffff; padding: 32px 24px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .email-header p { margin: 6px 0 0 0; opacity: 0.95; font-size: 14px; }
    .email-body { padding: 32px 24px; }
    .greeting { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
    .countdown-banner { background: ${badgeBg}; border: 1.5px solid ${badgeBorder}; border-radius: 10px; padding: 18px 20px; margin: 20px 0; text-align: center; }
    .countdown-number { font-size: 32px; font-weight: 800; color: ${badgeColor}; line-height: 1; }
    .countdown-label { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: ${badgeColor}; margin-top: 4px; }
    .info-box { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e2e8f0; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #64748b; font-weight: 500; }
    .info-value { font-weight: 700; color: #0f172a; }
    .btn-container { text-align: center; margin: 28px 0; }
    .pay-btn { display: inline-block; background: #4f46e5; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.3); }
    .instructions-box { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 16px; margin: 20px 0; font-size: 13px; color: #166534; line-height: 1.6; }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 22px 24px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>${headerTitle}</h1>
      <p>${this.escape(params.tenantName)} &bull; ${this.escape(params.planName)} Plan</p>
    </div>
    <div class="email-body">
      <div class="greeting">Hello ${this.escape(params.recipientName)},</div>
      
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        This is an automated reminder that your organization's subscription for the <strong>${this.escape(params.planName)}</strong> package will end on <strong>${this.escape(params.expiryDateFormatted)}</strong>.
      </p>

      <div class="countdown-banner">
        <div class="countdown-number">${params.daysRemaining}</div>
        <div class="countdown-label">${params.daysRemaining === 1 ? 'Day Remaining Before Workspace Deactivation' : 'Days Remaining Before Workspace Deactivation'}</div>
      </div>

      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Subscription Tier:</span>
          <span class="info-value">${this.escape(params.planName)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Expiration Date:</span>
          <span class="info-value" style="color: ${badgeColor};">${this.escape(params.expiryDateFormatted)}</span>
        </div>
        <div class="info-row" style="border-top: 1px solid #cbd5e1; padding-top: 10px; margin-top: 10px;">
          <span class="info-label" style="font-weight: 700;">Renewal Amount:</span>
          <span class="info-value" style="font-size: 18px; color: #4f46e5;">${this.escape(params.amountFormatted)}</span>
        </div>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        To ensure uninterrupted access to your projects, invoices, eTIMS integrations, and team collaboration, please renew your subscription now:
      </p>

      <div class="btn-container">
        <a href="${params.paymentUrl}" class="pay-btn" target="_blank">Renew Subscription Online (M-Pesa / Card) &rarr;</a>
      </div>

      <% if (params.paymentInstructions) { %>
        <div class="instructions-box">
          <strong>Quick Settlement Instructions:</strong><br>
          <pre style="white-space: pre-wrap; font-family: inherit; margin: 8px 0 0 0;">${this.escape(params.paymentInstructions)}</pre>
        </div>
      <% } %>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; text-align: center;">
        Payment link: <a href="${params.paymentUrl}" style="color: #4f46e5;">${params.paymentUrl}</a>
      </p>
    </div>
    <div class="email-footer">
      Automated Subscription Notification &bull; Free Style Code Technologies Ltd<br>
      Continuous uptime, rock-solid security, and automated cloud backups for your business.
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Compose modern HTML email for subscription payment success & workspace activation
   */
  generateSubscriptionPaymentSuccessEmailHtml(params: {
    tenantName: string;
    recipientName: string;
    planName: string;
    invoiceNumber: string;
    amountPaidFormatted: string;
    paymentMethod: string;
    paymentReference: string;
    newExpiryDateFormatted: string;
    portalUrl: string;
  }): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 0; }
    .email-container { max-width: 620px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .email-header { background: #059669; color: #ffffff; padding: 32px 24px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .email-header p { margin: 6px 0 0 0; opacity: 0.95; font-size: 14px; }
    .email-body { padding: 32px 24px; }
    .greeting { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
    .success-box { background: #ecfdf5; border: 1.5px solid #6ee7b7; border-radius: 8px; padding: 18px 20px; margin: 18px 0; color: #065f46; font-size: 14px; line-height: 1.6; }
    .info-box { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e2e8f0; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #64748b; font-weight: 500; }
    .info-value { font-weight: 700; color: #0f172a; }
    .btn-container { text-align: center; margin: 28px 0; }
    .dashboard-btn { display: inline-block; background: #059669; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(5, 150, 105, 0.3); }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 22px 24px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>Payment Confirmed &bull; Workspace Activated</h1>
      <p>${this.escape(params.tenantName)} &bull; ${this.escape(params.planName)} Plan</p>
    </div>
    <div class="email-body">
      <div class="greeting">Hello ${this.escape(params.recipientName)},</div>

      <div class="success-box">
        <strong>🎉 Payment Successful!</strong> We have received your payment of <strong>${this.escape(params.amountPaidFormatted)}</strong> for renewal invoice <strong>${this.escape(params.invoiceNumber)}</strong>. 
        Your organization workspace is now fully active and unrestricted.
      </div>

      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Invoice Settled:</span>
          <span class="info-value">${this.escape(params.invoiceNumber)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Subscription Tier:</span>
          <span class="info-value">${this.escape(params.planName)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Payment Method:</span>
          <span class="info-value">${this.escape(params.paymentMethod)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Transaction Reference:</span>
          <span class="info-value" style="font-family: monospace; font-size: 15px; color: #059669;">${this.escape(params.paymentReference)}</span>
        </div>
        <div class="info-row" style="border-top: 1px solid #cbd5e1; padding-top: 10px; margin-top: 10px;">
          <span class="info-label">New Subscription End Date:</span>
          <span class="info-value" style="color: #059669; font-size: 15px;">${this.escape(params.newExpiryDateFormatted)}</span>
        </div>
        <div class="info-row" style="border-top: 1px solid #cbd5e1; padding-top: 10px; margin-top: 10px;">
          <span class="info-label" style="font-weight: 700;">Total Amount Paid:</span>
          <span class="info-value" style="font-size: 18px; color: #059669;">${this.escape(params.amountPaidFormatted)}</span>
        </div>
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        You and your team members can now access all features including projects, tasks, client invoices, maintenance schedules, and analytics without interruption.
      </p>

      <div class="btn-container">
        <a href="${params.portalUrl}" class="dashboard-btn" target="_blank">Access Your Workspace Dashboard &rarr;</a>
      </div>
    </div>
    <div class="email-footer">
      Official Subscription Confirmation &bull; Free Style Code Technologies Ltd<br>
      Thank you for choosing our platform for your business operations.
    </div>
  </div>
</body>
</html>`;
  }

  private escape(str: any): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export const emailService = new EmailService();
export default emailService;
