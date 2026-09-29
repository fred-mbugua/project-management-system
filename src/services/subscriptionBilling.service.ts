// ══════════════════════════════════════════════════════════════════════
// Subscription Billing & Expiration Management Engine
// Checks package periods, deactivates expired tenants, dispatches invoices,
// and sends daily reminder emails during the final 3 days before expiration.
// ══════════════════════════════════════════════════════════════════════

import { query, withTransaction } from '../config/database';
import emailService from './email.service';
import logger from '../utils/logger';
import { formatKES } from '../utils/taxCalculator';
import appConfig from '../config/app';
import PlatformPaymentSettingsModel from '../models/platformSettings.model';

const billingLogger = logger.child('SubscriptionBillingService');

export interface ExpirationCheckResult {
  totalScanned: number;
  totalDeactivated: number;
  invoicesGenerated: number;
  details: Array<{
    tenantId: string;
    tenantName: string;
    planName: string;
    invoiceNumber: string;
    amount: number;
    ownerEmail: string;
  }>;
}

export interface RemindersCheckResult {
  totalScanned: number;
  remindersSent: number;
  details: Array<{
    tenantId: string;
    tenantName: string;
    planName: string;
    daysRemaining: number;
    recipientEmail: string;
  }>;
}

export class SubscriptionBillingService {
  private timer: NodeJS.Timeout | null = null;

  /**
   * Scan active subscriptions expiring within the next 3 days.
   * Dispatches a single reminder email per calendar day for the final 3 days (3 days, 2 days, 1 day remaining).
   */
  async checkAndSendExpiringReminders(): Promise<RemindersCheckResult> {
    billingLogger.info('🔍 Initiating 3-day subscription expiration reminder scan...');

    const result: RemindersCheckResult = {
      totalScanned: 0,
      remindersSent: 0,
      details: [],
    };

    try {
      // Find all subscriptions currently ACTIVE whose period ends within the next 3 days
      const sql = `
        SELECT 
          ts.id as subscription_id,
          ts.tenant_id,
          ts.current_period_start,
          ts.current_period_end,
          ts.plan_id,
          t.name as tenant_name,
          t.email as tenant_email,
          sp.name as plan_name,
          COALESCE(sp.price, sp.monthly_price, 0)::numeric as plan_price,
          u.id as owner_id,
          u.email as owner_email,
          u.first_name as owner_first_name,
          u.last_name as owner_last_name
        FROM tenant_subscriptions ts
        JOIN tenants t ON ts.tenant_id = t.id
        JOIN subscription_plans sp ON ts.plan_id = sp.id
        LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'TENANT_OWNER'
        WHERE ts.status = 'ACTIVE'
          AND ts.current_period_end > NOW()
          AND ts.current_period_end <= NOW() + INTERVAL '3 days 2 hours'
          AND (t.subscription_exempt IS NOT TRUE)
      `;

      const expiringRes = await query(sql);
      result.totalScanned = expiringRes.rows.length;

      if (expiringRes.rows.length === 0) {
        billingLogger.info('✅ No subscriptions expiring in the next 3 days.');
        return result;
      }

      billingLogger.info(`Found ${expiringRes.rows.length} subscription(s) ending within 3 days. Checking daily reminder status...`);

      for (const row of expiringRes.rows) {
        try {
          const tenantId = row.tenant_id;
          const subId = row.subscription_id;
          const tenantName = row.tenant_name;
          const planName = row.plan_name;
          const amount = parseFloat(row.plan_price || 0);
          const recipientEmail = row.owner_email || row.tenant_email;
          const recipientName = row.owner_first_name
            ? `${row.owner_first_name} ${row.owner_last_name || ''}`.trim()
            : tenantName;
          const expiryDate = new Date(row.current_period_end);

          // Calculate calendar days remaining (3, 2, or 1)
          const diffMs = expiryDate.getTime() - Date.now();
          const daysRemaining = Math.max(1, Math.min(3, Math.ceil(diffMs / (1000 * 60 * 60 * 24))));

          // Check if a reminder email has already been dispatched for this subscription on CURRENT_DATE
          const checkSentTodaySql = `
            SELECT id FROM subscription_reminder_logs
            WHERE subscription_id = $1 AND sent_date = CURRENT_DATE
            LIMIT 1
          `;
          const sentCheck = await query(checkSentTodaySql, [subId]);

          if (sentCheck.rows.length > 0) {
            billingLogger.debug(`Tenant "${tenantName}" has already received their daily reminder for today (${daysRemaining} days left).`);
            continue;
          }

          if (!recipientEmail) {
            billingLogger.warn(`No valid email found for tenant ${tenantName} to send reminder.`);
            continue;
          }

          // Fetch active payment settings to display in reminder
          const paymentSettings = await PlatformPaymentSettingsModel.getSettings();
          const paymentInstructions = paymentSettings.mpesaEnabled
            ? `M-Pesa: Pay to ${paymentSettings.mpesaShortcodeType} ${paymentSettings.mpesaShortcode}.`
            : '';

          const paymentUrl = `${appConfig.appUrl}/subscription/pay`;

          const emailHtml = emailService.generateSubscriptionReminderEmailHtml({
            tenantName,
            recipientName,
            planName,
            daysRemaining,
            expiryDateFormatted: expiryDate.toLocaleDateString('en-KE', { dateStyle: 'full' }),
            amountFormatted: formatKES(amount),
            paymentUrl,
            paymentInstructions,
          });

          const subject = daysRemaining === 1
            ? `⚠️ Urgent: Subscription for ${tenantName} expires tomorrow / today`
            : `Reminder: Subscription for ${tenantName} expires in ${daysRemaining} days`;

          const sent = await emailService.sendEmail({
            to: recipientEmail,
            subject,
            html: emailHtml,
          });

          if (sent) {
            // Record in reminder logs with UNIQUE constraint to prevent duplicate sends on the same calendar day
            await query(
              `
              INSERT INTO subscription_reminder_logs (
                id, tenant_id, subscription_id, days_remaining, sent_date, recipient_email, created_at
              ) VALUES (
                gen_random_uuid()::text, $1, $2, $3, CURRENT_DATE, $4, NOW()
              )
              ON CONFLICT (subscription_id, sent_date) DO NOTHING
              `,
              [tenantId, subId, daysRemaining, recipientEmail]
            );

            await query(
              `UPDATE tenant_subscriptions SET last_reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [subId]
            );

            result.remindersSent++;
            result.details.push({
              tenantId,
              tenantName,
              planName,
              daysRemaining,
              recipientEmail,
            });

            billingLogger.info(`📧 Dispatched Day-${daysRemaining} expiration reminder email to ${recipientEmail} (${tenantName})`);
          }
        } catch (itemErr: any) {
          billingLogger.error(`Error processing expiring reminder for tenant ${row.tenant_id}`, { error: itemErr.message });
        }
      }

      billingLogger.info(`🏁 Reminder scan completed: ${result.remindersSent} emails sent today.`);
      return result;
    } catch (error: any) {
      billingLogger.error('Failed to run subscription reminder scan', { error: error.message });
      throw error;
    }
  }

  /**
   * Scan all active tenant subscriptions, deactivate expired accounts,
   * generate renewal subscription invoices, and dispatch emails with payment instructions.
   */
  async checkAndEnforceExpiredSubscriptions(): Promise<ExpirationCheckResult> {
    billingLogger.info('🔍 Initiating scheduled subscription expiration check...');

    const result: ExpirationCheckResult = {
      totalScanned: 0,
      totalDeactivated: 0,
      invoicesGenerated: 0,
      details: [],
    };

    try {
      // Find all subscriptions currently ACTIVE whose period has elapsed
      const sql = `
        SELECT 
          ts.id as subscription_id,
          ts.tenant_id,
          ts.current_period_start,
          ts.current_period_end,
          ts.plan_id,
          t.name as tenant_name,
          t.email as tenant_email,
          t.is_active as tenant_is_active,
          sp.name as plan_name,
          COALESCE(sp.price, sp.monthly_price, 0)::numeric as plan_price,
          COALESCE(sp.interval_months, 1)::int as interval_months,
          sp.frequency as plan_frequency,
          u.id as owner_id,
          u.email as owner_email,
          u.first_name as owner_first_name,
          u.last_name as owner_last_name
        FROM tenant_subscriptions ts
        JOIN tenants t ON ts.tenant_id = t.id
        JOIN subscription_plans sp ON ts.plan_id = sp.id
        LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'TENANT_OWNER'
        WHERE ts.status = 'ACTIVE' 
          AND ts.current_period_end < NOW()
          AND (t.subscription_exempt IS NOT TRUE)
      `;

      const expiredRes = await query(sql);
      result.totalScanned = expiredRes.rows.length;

      if (expiredRes.rows.length === 0) {
        billingLogger.info('✅ No newly expired subscriptions detected.');
        return result;
      }

      billingLogger.warn(`⚠️ Detected ${expiredRes.rows.length} expired subscription(s). Proceeding with deactivation & auto-invoicing.`);

      const paymentSettings = await PlatformPaymentSettingsModel.getSettings();

      for (const row of expiredRes.rows) {
        try {
          const tenantId = row.tenant_id;
          const tenantName = row.tenant_name;
          const planName = row.plan_name;
          const amount = parseFloat(row.plan_price || 0);
          const intervalMonths = parseInt(row.interval_months, 10) || 1;
          const recipientEmail = row.owner_email || row.tenant_email;
          const recipientName = row.owner_first_name ? `${row.owner_first_name} ${row.owner_last_name || ''}`.trim() : tenantName;

          // Check if an existing UNPAID invoice already exists for this tenant
          const existingInvoiceRes = await query(
            `SELECT * FROM subscription_invoices WHERE tenant_id = $1 AND status = 'UNPAID' ORDER BY created_at DESC LIMIT 1`,
            [tenantId]
          );

          let invoiceNumber: string;
          let dueDate: Date;

          if (existingInvoiceRes.rows.length > 0) {
            invoiceNumber = existingInvoiceRes.rows[0].invoice_number;
            dueDate = new Date(existingInvoiceRes.rows[0].due_date);
          } else {
            const year = new Date().getFullYear();
            const rand = Math.floor(100000 + Math.random() * 900000);
            invoiceNumber = `SUB-INV-${year}-${rand}`;
            dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 7);
          }

          const periodStart = new Date(row.current_period_end);
          const periodEnd = new Date(periodStart);
          periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);

          const paymentUrl = `${appConfig.appUrl}/subscription/pay`;

          const paymentInstructions = `
Please make payment for your ${planName} subscription renewal:
1. Safaricom M-Pesa:
   • Paybill / Till: ${paymentSettings.mpesaShortcode} (${paymentSettings.mpesaShortcodeType})
   • Account No: ${invoiceNumber}
   • Amount: KES ${amount.toLocaleString()}

2. Direct Online Payment:
   • Visit: ${paymentUrl}
   • Choose instant M-Pesa prompt, Card Checkout, or PayPal Express.

Upon settlement, your workspace will be immediately reactivated automatically.
          `.trim();

          await withTransaction(async (client) => {
            // 1. Deactivate organization account
            await client.query(
              `UPDATE tenants SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
              [tenantId]
            );

            // 2. Mark subscription as EXPIRED
            await client.query(
              `UPDATE tenant_subscriptions SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
              [row.subscription_id]
            );

            // 3. Create or update renewal invoice
            if (existingInvoiceRes.rows.length === 0) {
              await client.query(
                `
                INSERT INTO subscription_invoices (
                  id, tenant_id, plan_id, invoice_number,
                  amount, tax_amount, total_amount, status,
                  billing_period_start, billing_period_end, due_date,
                  payment_instructions, updated_at
                ) VALUES (
                  gen_random_uuid()::text, $1, $2, $3,
                  $4, 0, $4, 'UNPAID',
                  $5, $6, $7,
                  $8, NOW()
                )
                `,
                [
                  tenantId,
                  row.plan_id,
                  invoiceNumber,
                  amount,
                  periodStart,
                  periodEnd,
                  dueDate,
                  paymentInstructions,
                ]
              );
              result.invoicesGenerated++;
            }

            // 4. Log audit trail
            await client.query(
              `
              INSERT INTO audit_logs (
                id, tenant_id, action, entity_type, entity_id, description, metadata, created_at
              ) VALUES (
                gen_random_uuid()::text, $1, 'UPDATE', 'TENANT_SUBSCRIPTION', $2, $3, $4, NOW()
              )
              `,
              [
                tenantId,
                row.subscription_id,
                `Subscription expired for ${tenantName}. Account marked for renewal and invoice ${invoiceNumber} issued.`,
                JSON.stringify({ invoiceNumber, amount, planName, dueDate }),
              ]
            );
          });

          result.totalDeactivated++;
          result.details.push({
            tenantId,
            tenantName,
            planName,
            invoiceNumber,
            amount,
            ownerEmail: recipientEmail,
          });

          // 5. Send renewal invoice email with payment instructions and direct payment link
          if (recipientEmail) {
            const emailHtml = this.generateExpiredInvoiceEmailHtml({
              tenantName,
              recipientName,
              planName,
              invoiceNumber,
              amountFormatted: formatKES(amount),
              dueDateFormatted: dueDate.toLocaleDateString('en-KE', { dateStyle: 'medium' }),
              paymentInstructions,
              paymentUrl,
            });

            await emailService.sendEmail({
              to: recipientEmail,
              subject: `Action Required: Subscription Expired for ${tenantName} - Invoice ${invoiceNumber}`,
              html: emailHtml,
            });
            billingLogger.info(`📧 Dispatched renewal invoice email to ${recipientEmail} for tenant ${tenantName}`);
          }
        } catch (itemErr: any) {
          billingLogger.error(`Error processing expired subscription for tenant ${row.tenant_id}`, { error: itemErr.message });
        }
      }

      billingLogger.info(`🏁 Expiration check completed: ${result.totalDeactivated} accounts deactivated, ${result.invoicesGenerated} invoices generated.`);
      return result;
    } catch (error: any) {
      billingLogger.error('Failed to run subscription expiration check', { error: error.message });
      throw error;
    }
  }

  /**
   * Run all scheduled subscription checks:
   * 1. 3-day reminder scans (ensuring 1 email per calendar day per subscription)
   * 2. Expiration checks and deactivation
   */
  async runAllSubscriptionJobs(): Promise<void> {
    try {
      await this.checkAndSendExpiringReminders();
    } catch (err: any) {
      billingLogger.error('Error during reminder scan:', { error: err.message });
    }

    try {
      await this.checkAndEnforceExpiredSubscriptions();
    } catch (err: any) {
      billingLogger.error('Error during expiration scan:', { error: err.message });
    }
  }

  /**
   * Start recurring background timer (checks every 1 hour)
   */
  startScheduledChecker(intervalMs: number = 60 * 60 * 1000): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    billingLogger.info('⏰ Subscription billing & 3-day reminder scheduled background service activated.');

    // Initial check after 15 seconds
    setTimeout(() => {
      this.runAllSubscriptionJobs().catch((err) => {
        billingLogger.warn('Initial subscription job error:', { error: err.message });
      });
    }, 15000);

    // Periodic interval (every 1 hour)
    this.timer = setInterval(() => {
      this.runAllSubscriptionJobs().catch((err) => {
        billingLogger.error('Scheduled subscription job error:', { error: err.message });
      });
    }, intervalMs);
  }

  /**
   * Stop scheduled timer
   */
  stopScheduledChecker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Generate clean HTML email for expired subscription invoice & payment instructions
   */
  private generateExpiredInvoiceEmailHtml(params: {
    tenantName: string;
    recipientName: string;
    planName: string;
    invoiceNumber: string;
    amountFormatted: string;
    dueDateFormatted: string;
    paymentInstructions: string;
    paymentUrl: string;
  }): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 0; }
    .email-container { max-width: 620px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }
    .email-header { background: #dc2626; color: #ffffff; padding: 32px 24px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .email-header p { margin: 6px 0 0 0; opacity: 0.95; font-size: 14px; }
    .email-body { padding: 32px 24px; }
    .greeting { font-size: 16px; font-weight: 700; margin-bottom: 16px; }
    .warning-box { background: #fef2f2; border: 1.5px solid #f87171; border-radius: 8px; padding: 18px; margin: 18px 0; color: #991b1b; }
    .info-box { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #e2e8f0; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .info-row:last-child { margin-bottom: 0; }
    .info-label { color: #64748b; font-weight: 500; }
    .info-value { font-weight: 700; color: #0f172a; }
    .btn-container { text-align: center; margin: 28px 0; }
    .pay-btn { display: inline-block; background: #dc2626; color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 14px rgba(220, 38, 38, 0.3); }
    .instructions-box { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .instructions-title { font-weight: 700; color: #166534; font-size: 15px; margin-bottom: 10px; }
    .instructions-content { font-family: monospace; font-size: 13px; color: #14532d; white-space: pre-wrap; line-height: 1.6; }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 22px 24px; font-size: 12px; color: #64748b; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1>Subscription Expired &bull; Account Notice</h1>
      <p>${params.tenantName} &bull; Invoice ${params.invoiceNumber}</p>
    </div>
    <div class="email-body">
      <div class="greeting">Hello ${params.recipientName},</div>
      
      <div class="warning-box">
        <strong>Important Account Notice:</strong> Your subscription for the <strong>${params.planName}</strong> plan has expired. 
        Your organization workspace has been temporarily suspended pending renewal settlement.
      </div>

      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        To restore immediate full access to all your project management, invoices, eTIMS tax compliance, and team members, please settle the renewal invoice below:
      </p>

      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Invoice Reference:</span>
          <span class="info-value">${params.invoiceNumber}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Subscription Tier:</span>
          <span class="info-value">${params.planName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Payment Due Date:</span>
          <span class="info-value">${params.dueDateFormatted}</span>
        </div>
        <div class="info-row" style="border-top: 1px solid #cbd5e1; padding-top: 10px; margin-top: 10px;">
          <span class="info-label" style="font-size: 16px; font-weight: 700;">Total Renewal Due:</span>
          <span class="info-value" style="font-size: 20px; color: #dc2626;">${params.amountFormatted}</span>
        </div>
      </div>

      <div class="btn-container">
        <a href="${params.paymentUrl}" class="pay-btn" target="_blank">Pay Online & Reactivate Workspace Now &rarr;</a>
      </div>

      <div class="instructions-box">
        <div class="instructions-title">Official Payment Settlement Instructions</div>
        <div class="instructions-content">${params.paymentInstructions}</div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; text-align: center;">
        Payment link: <a href="${params.paymentUrl}" style="color: #dc2626;">${params.paymentUrl}</a>
      </p>
    </div>
    <div class="email-footer">
      Free Style Code Technologies Ltd &bull; Automated Platform Subscription Engine<br>
      Protecting your business systems with continuous uptime and dedicated infrastructure.
    </div>
  </div>
</body>
</html>`;
  }
}

export const subscriptionBillingService = new SubscriptionBillingService();
export default subscriptionBillingService;
