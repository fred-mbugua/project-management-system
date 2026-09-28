// ══════════════════════════════════════════════════════════════════════
// Subscription Billing & Expiration Management Engine
// Checks package periods, deactivates expired tenants, and dispatches invoices
// ══════════════════════════════════════════════════════════════════════

import { query, withTransaction } from '../config/database';
import emailService from './email.service';
import logger from '../utils/logger';
import { formatKES } from '../utils/taxCalculator';

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

export class SubscriptionBillingService {
  private timer: NodeJS.Timeout | null = null;

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
      `;

      const expiredRes = await query(sql);
      result.totalScanned = expiredRes.rows.length;

      if (expiredRes.rows.length === 0) {
        billingLogger.info('✅ No expired subscriptions detected. All active accounts are up to date.');
        return result;
      }

      billingLogger.warn(`⚠️ Detected ${expiredRes.rows.length} expired subscription(s). Proceeding with deactivation & auto-invoicing.`);

      for (const row of expiredRes.rows) {
        try {
          const tenantId = row.tenant_id;
          const tenantName = row.tenant_name;
          const planName = row.plan_name;
          const amount = parseFloat(row.plan_price || 0);
          const intervalMonths = parseInt(row.interval_months, 10) || 1;
          const recipientEmail = row.owner_email || row.tenant_email;
          const recipientName = row.owner_first_name ? `${row.owner_first_name} ${row.owner_last_name || ''}`.trim() : tenantName;

          const year = new Date().getFullYear();
          const rand = Math.floor(100000 + Math.random() * 900000);
          const invoiceNumber = `SUB-INV-${year}-${rand}`;

          const periodStart = new Date(row.current_period_end);
          const periodEnd = new Date(periodStart);
          periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);

          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 7); // 7 days grace/payment window

          const paymentInstructions = `
Please make payment for your ${planName} subscription renewal:
1. Safaricom M-Pesa Paybill:
   • Business No: 522522 / 247247 (or platform shortcode)
   • Account No: ${invoiceNumber}
   • Amount: KES ${amount.toLocaleString()}

2. Direct Bank Settlement:
   • Bank: NCBA Bank Kenya / Equity Bank
   • Account Name: Free Style Code Technologies Ltd
   • Account Number: 0140 8920 1820
   • Reference: ${invoiceNumber}

Upon payment settlement, your organization workspace will be immediately reactivated automatically.
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

            // 3. Create SaaS platform subscription renewal invoice
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
                `Subscription expired for ${tenantName}. Account deactivated and invoice ${invoiceNumber} issued.`,
                JSON.stringify({ invoiceNumber, amount, planName, dueDate }),
              ]
            );
          });

          result.totalDeactivated++;
          result.invoicesGenerated++;
          result.details.push({
            tenantId,
            tenantName,
            planName,
            invoiceNumber,
            amount,
            ownerEmail: recipientEmail,
          });

          // 5. Send renewal invoice email with payment instructions
          if (recipientEmail) {
            const emailHtml = this.generateExpiredInvoiceEmailHtml({
              tenantName,
              recipientName,
              planName,
              invoiceNumber,
              amountFormatted: formatKES(amount),
              dueDateFormatted: dueDate.toLocaleDateString('en-KE', { dateStyle: 'medium' }),
              paymentInstructions,
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
   * Start recurring background timer (checks every 12 hours)
   */
  startScheduledChecker(intervalMs: number = 12 * 60 * 60 * 1000): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    billingLogger.info('⏰ Subscription expiration scheduled background service activated.');
    
    // Initial check after 30 seconds
    setTimeout(() => {
      this.checkAndEnforceExpiredSubscriptions().catch((err) => {
        billingLogger.warn('Initial subscription check error:', { error: err.message });
      });
    }, 30000);

    // Periodic interval
    this.timer = setInterval(() => {
      this.checkAndEnforceExpiredSubscriptions().catch((err) => {
        billingLogger.error('Scheduled subscription check error:', { error: err.message });
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
    .instructions-box { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .instructions-title { font-weight: 700; color: #166534; font-size: 15px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
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
        <strong>Important Account Notice:</strong> Your subscription for the <strong>${params.planName}</strong> plan has reached the end of its billing cycle and has expired. 
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

      <div class="instructions-box">
        <div class="instructions-title">Official Payment Settlement Instructions</div>
        <div class="instructions-content">${params.paymentInstructions}</div>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
        Need assistance or want to upgrade or change your subscription package? Contact our platform administrator or reply to this notice.
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
