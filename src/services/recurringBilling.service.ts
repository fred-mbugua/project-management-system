// ══════════════════════════════════════════════════════════════════════
// Recurring Billing & Automated Invoicing Engine
// Detects due maintenance schedules, generates real invoices, 
// advances cadences, and dispatches email with online payment links
// ══════════════════════════════════════════════════════════════════════

import cron from 'node-cron';
import { query } from '../config/database';
import { pdfService } from './pdf.service';
import { emailService } from './email.service';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const billingLogger = logger.child('RecurringBillingService');

export interface AutoBillingResult {
  schedulesChecked: number;
  invoicesGenerated: number;
  emailsSent: number;
  errors: string[];
}

export interface BillingCycleInfo {
  cycleIndex: number;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  isElapsed: boolean;
  statusText: string;
}

export class RecurringBillingService {
  private isCronInitialized: boolean = false;

  /**
   * Initialize automated daily midnight cron runner
   */
  initCron(): void {
    if (this.isCronInitialized) return;

    // Run every day at 00:05
    cron.schedule('5 0 * * *', async () => {
      billingLogger.info('⏰ Scheduled recurring billing job triggered');
      try {
        await this.runAutoBilling();
      } catch (err: any) {
        billingLogger.error('Scheduled recurring billing job failed', { error: err?.message });
      }
    });

    this.isCronInitialized = true;
    billingLogger.info('✅ Recurring billing cron runner registered (00:05 daily)');
  }

  /**
   * Calculate next due date from a given base date and frequency
   */
  calculateNextDueDate(currentDate: Date, frequency: string, intervalMonths: number = 1): Date {
    const next = new Date(currentDate);

    switch (frequency) {
      case 'WEEKLY':
        next.setDate(next.getDate() + 7);
        break;
      case 'BIWEEKLY':
        next.setDate(next.getDate() + 14);
        break;
      case 'MONTHLY':
        next.setMonth(next.getMonth() + (intervalMonths > 0 ? intervalMonths : 1));
        break;
      case 'QUARTERLY':
        next.setMonth(next.getMonth() + 3);
        break;
      case 'BIANNUAL':
        next.setMonth(next.getMonth() + 6);
        break;
      case 'ANNUAL':
        next.setFullYear(next.getFullYear() + 1);
        break;
      case 'CUSTOM':
        next.setMonth(next.getMonth() + (intervalMonths > 0 ? intervalMonths : 1));
        break;
      default:
        next.setMonth(next.getMonth() + (intervalMonths > 0 ? intervalMonths : 1));
        break;
    }

    return next;
  }

  /**
   * Calculate all billing cycle dates from a start date, frequency, interval, and optional end date
   */
  calculateBillingCycles(
    startDate: Date,
    frequency: string,
    intervalMonths: number = 1,
    endDate?: Date | null,
    referenceDate: Date = new Date(),
    maxFutureCycles: number = 6
  ): {
    elapsedCycles: BillingCycleInfo[];
    upcomingCycles: BillingCycleInfo[];
    nextDueDate: Date;
  } {
    const elapsedCycles: BillingCycleInfo[] = [];
    const upcomingCycles: BillingCycleInfo[] = [];

    const interval = Math.max(1, intervalMonths || 1);
    let currentStart = new Date(startDate);

    // Normalize reference date to end of current day to check elapsed status
    const refDayEnd = new Date(referenceDate);
    refDayEnd.setHours(23, 59, 59, 999);
    const refTime = refDayEnd.getTime();

    const endDateTime = endDate ? new Date(endDate).getTime() : null;
    let cycleIndex = 1;

    // Safety limit of 300 cycles
    while (cycleIndex <= 300) {
      if (endDateTime && currentStart.getTime() > endDateTime) {
        break;
      }

      const cycleDueDate = new Date(currentStart);
      const nextCycleStart = this.calculateNextDueDate(currentStart, frequency, interval);

      const periodEnd = new Date(nextCycleStart);
      periodEnd.setDate(periodEnd.getDate() - 1);

      const isElapsed = cycleDueDate.getTime() <= refTime;

      const cycleInfo: BillingCycleInfo = {
        cycleIndex,
        periodStart: new Date(currentStart),
        periodEnd,
        dueDate: cycleDueDate,
        isElapsed,
        statusText: isElapsed ? 'Accrued (Past Due)' : (upcomingCycles.length === 0 ? 'Next Due' : 'Upcoming'),
      };

      if (isElapsed) {
        elapsedCycles.push(cycleInfo);
      } else {
        upcomingCycles.push(cycleInfo);
        if (!endDateTime && upcomingCycles.length >= maxFutureCycles) {
          break;
        }
      }

      currentStart = nextCycleStart;
      cycleIndex++;
    }

    const nextDueDate = upcomingCycles.length > 0
      ? upcomingCycles[0].dueDate
      : (elapsedCycles.length > 0 ? elapsedCycles[elapsedCycles.length - 1].dueDate : new Date(startDate));

    return {
      elapsedCycles,
      upcomingCycles,
      nextDueDate,
    };
  }

  /**
   * Generate next sequential invoice number for a tenant
   */
  private async getNextInvoiceNumber(tenantId: string, prefix: string = 'INV'): Promise<string> {
    const year = new Date().getFullYear();
    const countRes = await query(
      `SELECT COUNT(*)::int as count FROM invoices WHERE tenant_id = $1`,
      [tenantId]
    );
    const num = (countRes.rows[0]?.count || 0) + 1;
    return `${prefix}-${year}-${String(num).padStart(4, '0')}`;
  }

  /**
   * Run auto-billing scan across all or specific tenant
   */
  async runAutoBilling(specificTenantId?: string): Promise<AutoBillingResult> {
    const result: AutoBillingResult = {
      schedulesChecked: 0,
      invoicesGenerated: 0,
      emailsSent: 0,
      errors: [],
    };

    try {
      let sql = `
        SELECT 
          m.*,
          t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone,
          t.address as tenant_address, t.city as tenant_city, t.kra_pin as tenant_kra_pin,
          t.logo_url as tenant_logo_url, t.primary_color as tenant_primary_color,
          t.invoice_prefix as tenant_invoice_prefix, t.invoice_template as tenant_invoice_template,
          t.display_fields as tenant_display_fields, t.bank_details as tenant_bank_details,
          t.daraja_shortcode as tenant_daraja_shortcode, t.daraja_shortcode_type as tenant_daraja_shortcode_type,
          c.name as client_name, c.email as client_email, c.phone as client_phone,
          c.address as client_address, c.city as client_city, c.kra_pin as client_kra_pin,
          p.name as project_name, p.code as project_code
        FROM maintenance_schedules m
        JOIN tenants t ON m.tenant_id = t.id
        JOIN clients c ON m.client_id = c.id
        LEFT JOIN projects p ON m.project_id = p.id
        WHERE m.status = 'ACTIVE' 
          AND m.auto_invoice = TRUE 
          AND m.next_due_date <= NOW()
      `;
      const params: any[] = [];

      if (specificTenantId) {
        sql += ` AND m.tenant_id = $1`;
        params.push(specificTenantId);
      }

      sql += ` ORDER BY m.next_due_date ASC`;

      const schedulesRes = await query(sql, params);
      result.schedulesChecked = schedulesRes.rows.length;

      billingLogger.info(`Found ${schedulesRes.rows.length} recurring schedules due for automated invoicing`);

      const baseUrl = process.env.APP_URL || 'http://localhost:3000';

      for (const schedule of schedulesRes.rows) {
        try {
          const invoiceNumber = await this.getNextInvoiceNumber(
            schedule.tenant_id,
            schedule.tenant_invoice_prefix || 'INV'
          );

          const chargeAmount = parseFloat(String(schedule.charge_amount)) || 0;
          const taxRate = parseFloat(String(schedule.tax_rate ?? 16)) || 0;
          const taxAmount = taxRate > 0 ? chargeAmount * (taxRate / 100) : 0;
          const totalAmount = chargeAmount + taxAmount;

          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + (schedule.notify_days_before || 14));

          // Create invoice with public payment token
          const invoiceInsertSql = `
            INSERT INTO invoices (
              id, tenant_id, client_id, project_id, recurring_schedule_id,
              invoice_number, title, status, issue_date, due_date,
              subtotal, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
              notes, terms, template, tenant_kra_pin, client_kra_pin, public_token, created_at, updated_at
            ) VALUES (
              gen_random_uuid()::text, $1, $2, $3, $4,
              $5, $6, 'SENT', NOW(), $7,
              $8, $9, 0, $10, 0, $10,
              $11, $12, $13, $14, $15, gen_random_uuid()::text, NOW(), NOW()
            )
            RETURNING *
          `;

          const invoiceRes = await query(invoiceInsertSql, [
            schedule.tenant_id,
            schedule.client_id,
            schedule.project_id || null,
            schedule.id,
            invoiceNumber,
            schedule.title,
            dueDate,
            chargeAmount,
            taxAmount,
            totalAmount,
            schedule.notes || `Recurring maintenance contract retainer (${schedule.frequency}).`,
            'Payment is due upon receipt. M-Pesa and Card payments accepted.',
            schedule.tenant_invoice_template || 'modern',
            schedule.tenant_kra_pin || 'P000000000X',
            schedule.client_kra_pin || null,
          ]);

          const createdInvoice = invoiceRes.rows[0];

          // Insert item
          await query(
            `INSERT INTO invoice_items (
              id, invoice_id, description, quantity, unit_price, discount_percent,
              tax_type, tax_rate, line_total, line_tax, sort_order
            ) VALUES (
              gen_random_uuid()::text, $1, $2, 1, $3, 0,
              $4, $5, $6, $7, 1
            )`,
            [
              createdInvoice.id,
              schedule.title,
              chargeAmount,
              schedule.tax_type || 'VAT_16',
              taxRate,
              totalAmount,
              taxAmount,
            ]
          );

          // Advance cadence
          const nextDueDate = this.calculateNextDueDate(
            new Date(schedule.next_due_date),
            schedule.frequency,
            schedule.interval_months || 1
          );

          await query(
            `UPDATE maintenance_schedules 
             SET last_completed_date = NOW(),
                 last_invoice_id = $1,
                 next_due_date = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [createdInvoice.id, nextDueDate, schedule.id]
          );

          result.invoicesGenerated++;

          // Send automated email if enabled and client email exists
          if (schedule.auto_send_email !== false && schedule.client_email) {
            try {
              const paymentUrl = `${baseUrl}/pay/${createdInvoice.public_token}`;

              // Generate PDF attachment
              let displayFields: any = {};
              if (schedule.tenant_display_fields) {
                try {
                  displayFields = typeof schedule.tenant_display_fields === 'string'
                    ? JSON.parse(schedule.tenant_display_fields)
                    : schedule.tenant_display_fields;
                } catch {}
              }

              const pdfBuffer = await pdfService.generateDocumentPdfBuffer({
                type: 'invoice',
                documentNumber: invoiceNumber,
                title: schedule.title,
                status: 'SENT',
                issueDate: createdInvoice.issue_date,
                dueDateOrValidUntil: createdInvoice.due_date,
                dueDateLabel: 'Due Date',
                notes: createdInvoice.notes,
                terms: createdInvoice.terms,
                template: schedule.tenant_invoice_template || 'modern',
                customColor: schedule.tenant_primary_color || '#4F46E5',
                displayFields,
                subtotal: chargeAmount,
                taxAmount: taxAmount,
                totalAmount: totalAmount,
                balanceDue: totalAmount,
                tenant: {
                  name: schedule.tenant_name,
                  email: schedule.tenant_email,
                  phone: schedule.tenant_phone,
                  address: schedule.tenant_address,
                  city: schedule.tenant_city,
                  kraPin: schedule.tenant_kra_pin,
                  logoUrl: schedule.tenant_logo_url,
                  primaryColor: schedule.tenant_primary_color,
                  bankDetails: schedule.tenant_bank_details,
                  darajaShortcode: schedule.tenant_daraja_shortcode,
                  darajaShortcodeType: schedule.tenant_daraja_shortcode_type,
                },
                client: {
                  name: schedule.client_name,
                  email: schedule.client_email,
                  phone: schedule.client_phone,
                  address: schedule.client_address,
                  city: schedule.client_city,
                  kraPin: schedule.client_kra_pin,
                },
                project: schedule.project_name ? { name: schedule.project_name, code: schedule.project_code } : null,
                items: [
                  {
                    description: schedule.title,
                    quantity: 1,
                    unitPrice: chargeAmount,
                    lineTax: taxAmount,
                    lineTotal: totalAmount,
                  },
                ],
              });

              const emailHtml = emailService.generateInvoiceEmailHtml({
                tenantName: schedule.tenant_name,
                clientName: schedule.client_name,
                invoiceNumber,
                totalAmountFormatted: formatKES(totalAmount),
                dueDateFormatted: new Date(dueDate).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }),
                paymentUrl,
              });

              const sent = await emailService.sendEmail({
                to: schedule.client_email,
                fromName: schedule.tenant_name,
                replyTo: schedule.tenant_email,
                subject: `Invoice ${invoiceNumber} from ${schedule.tenant_name} (${formatKES(totalAmount)})`,
                html: emailHtml,
                attachments: [
                  {
                    filename: `Invoice-${invoiceNumber}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                  },
                ],
              });

              if (sent) result.emailsSent++;
            } catch (mailErr: any) {
              billingLogger.warn('Could not dispatch invoice email', {
                invoiceNumber,
                clientEmail: schedule.client_email,
                error: mailErr?.message,
              });
            }
          }

          billingLogger.info(`Successfully generated recurring invoice ${invoiceNumber} for ${schedule.client_name}`);
        } catch (itemErr: any) {
          const msg = `Schedule ${schedule.id} (${schedule.title}) failed: ${itemErr?.message}`;
          billingLogger.error(msg);
          result.errors.push(msg);
        }
      }
    } catch (err: any) {
      billingLogger.error('runAutoBilling overall failure', { error: err?.message });
      result.errors.push(err?.message);
    }

    return result;
  }

  /**
   * Manually trigger immediate invoice generation for a specific maintenance schedule
   */
  async generateSingleInvoice(scheduleId: string, tenantId?: string): Promise<{
    success: boolean;
    invoiceId?: string;
    invoiceNumber?: string;
    publicToken?: string;
    totalAmount?: number;
    emailSent?: boolean;
    error?: string;
  }> {
    try {
      let sql = `
        SELECT 
          m.*,
          t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone,
          t.address as tenant_address, t.city as tenant_city, t.kra_pin as tenant_kra_pin,
          t.logo_url as tenant_logo_url, t.primary_color as tenant_primary_color,
          t.invoice_prefix as tenant_invoice_prefix, t.invoice_template as tenant_invoice_template,
          t.display_fields as tenant_display_fields, t.bank_details as tenant_bank_details,
          t.daraja_shortcode as tenant_daraja_shortcode, t.daraja_shortcode_type as tenant_daraja_shortcode_type,
          c.name as client_name, c.email as client_email, c.phone as client_phone,
          c.address as client_address, c.city as client_city, c.kra_pin as client_kra_pin,
          p.name as project_name, p.code as project_code
        FROM maintenance_schedules m
        JOIN tenants t ON m.tenant_id = t.id
        JOIN clients c ON m.client_id = c.id
        LEFT JOIN projects p ON m.project_id = p.id
        WHERE m.id = $1
      `;
      const params: any[] = [scheduleId];

      if (tenantId) {
        sql += ` AND m.tenant_id = $2`;
        params.push(tenantId);
      }

      const res = await query(sql, params);
      const schedule = res.rows[0];

      if (!schedule) {
        return { success: false, error: 'Maintenance schedule not found' };
      }

      const invoiceNumber = await this.getNextInvoiceNumber(
        schedule.tenant_id,
        schedule.tenant_invoice_prefix || 'INV'
      );

      const chargeAmount = parseFloat(String(schedule.charge_amount)) || 0;
      const taxRate = parseFloat(String(schedule.tax_rate ?? 16)) || 0;
      const taxAmount = taxRate > 0 ? chargeAmount * (taxRate / 100) : 0;
      const totalAmount = chargeAmount + taxAmount;

      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (schedule.notify_days_before || 14));

      // Create invoice with public payment token
      const invoiceInsertSql = `
        INSERT INTO invoices (
          id, tenant_id, client_id, project_id, recurring_schedule_id,
          invoice_number, title, status, issue_date, due_date,
          subtotal, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
          notes, terms, template, tenant_kra_pin, client_kra_pin, public_token, created_at, updated_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4,
          $5, $6, 'SENT', NOW(), $7,
          $8, $9, 0, $10, 0, $10,
          $11, $12, $13, $14, $15, gen_random_uuid()::text, NOW(), NOW()
        )
        RETURNING *
      `;

      const invoiceRes = await query(invoiceInsertSql, [
        schedule.tenant_id,
        schedule.client_id,
        schedule.project_id || null,
        schedule.id,
        invoiceNumber,
        schedule.title,
        dueDate,
        chargeAmount,
        taxAmount,
        totalAmount,
        schedule.notes || `Recurring maintenance contract retainer (${schedule.frequency}).`,
        'Payment is due upon receipt. M-Pesa and Card payments accepted.',
        schedule.tenant_invoice_template || 'modern',
        schedule.tenant_kra_pin || 'P000000000X',
        schedule.client_kra_pin || null,
      ]);

      const createdInvoice = invoiceRes.rows[0];

      // Insert line item
      await query(
        `INSERT INTO invoice_items (
          id, invoice_id, description, quantity, unit_price, discount_percent,
          tax_type, tax_rate, line_total, line_tax, sort_order
        ) VALUES (
          gen_random_uuid()::text, $1, $2, 1, $3, 0,
          $4, $5, $6, $7, 1
        )`,
        [
          createdInvoice.id,
          schedule.title,
          chargeAmount,
          schedule.tax_type || 'VAT_16',
          taxRate,
          totalAmount,
          taxAmount,
        ]
      );

      // Advance cadence
      const nextDueDate = this.calculateNextDueDate(
        new Date(schedule.next_due_date || new Date()),
        schedule.frequency,
        schedule.interval_months || 1
      );

      await query(
        `UPDATE maintenance_schedules 
         SET last_completed_date = NOW(),
             last_invoice_id = $1,
             next_due_date = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [createdInvoice.id, nextDueDate, schedule.id]
      );

      let emailSent = false;
      const baseUrl = process.env.APP_URL || 'http://localhost:3000';

      // Send automated email if enabled and client email exists
      if (schedule.auto_send_email !== false && schedule.client_email) {
        try {
          const paymentUrl = `${baseUrl}/pay/${createdInvoice.public_token}`;

          let displayFields: any = {};
          if (schedule.tenant_display_fields) {
            try {
              displayFields = typeof schedule.tenant_display_fields === 'string'
                ? JSON.parse(schedule.tenant_display_fields)
                : schedule.tenant_display_fields;
            } catch {}
          }

          const pdfBuffer = await pdfService.generateDocumentPdfBuffer({
            type: 'invoice',
            documentNumber: invoiceNumber,
            title: schedule.title,
            status: 'SENT',
            issueDate: createdInvoice.issue_date,
            dueDateOrValidUntil: createdInvoice.due_date,
            dueDateLabel: 'Due Date',
            notes: createdInvoice.notes,
            terms: createdInvoice.terms,
            template: schedule.tenant_invoice_template || 'modern',
            customColor: schedule.tenant_primary_color || '#4F46E5',
            displayFields,
            subtotal: chargeAmount,
            taxAmount: taxAmount,
            totalAmount: totalAmount,
            balanceDue: totalAmount,
            tenant: {
              name: schedule.tenant_name,
              email: schedule.tenant_email,
              phone: schedule.tenant_phone,
              address: schedule.tenant_address,
              city: schedule.tenant_city,
              kraPin: schedule.tenant_kra_pin,
              logoUrl: schedule.tenant_logo_url,
              primaryColor: schedule.tenant_primary_color,
              bankDetails: schedule.tenant_bank_details,
              darajaShortcode: schedule.tenant_daraja_shortcode,
              darajaShortcodeType: schedule.tenant_daraja_shortcode_type,
            },
            client: {
              name: schedule.client_name,
              email: schedule.client_email,
              phone: schedule.client_phone,
              address: schedule.client_address,
              city: schedule.client_city,
              kraPin: schedule.client_kra_pin,
            },
            project: schedule.project_name ? { name: schedule.project_name, code: schedule.project_code } : null,
            items: [
              {
                description: schedule.title,
                quantity: 1,
                unitPrice: chargeAmount,
                lineTax: taxAmount,
                lineTotal: totalAmount,
              },
            ],
          });

          const emailHtml = emailService.generateInvoiceEmailHtml({
            tenantName: schedule.tenant_name,
            clientName: schedule.client_name,
            invoiceNumber,
            totalAmountFormatted: formatKES(totalAmount),
            dueDateFormatted: new Date(dueDate).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' }),
            paymentUrl,
          });

          const sent = await emailService.sendEmail({
            to: schedule.client_email,
            fromName: schedule.tenant_name,
            replyTo: schedule.tenant_email,
            subject: `Invoice ${invoiceNumber} from ${schedule.tenant_name} (${formatKES(totalAmount)})`,
            html: emailHtml,
            attachments: [
              {
                filename: `Invoice-${invoiceNumber}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
              },
            ],
          });

          if (sent) emailSent = true;
        } catch (mailErr: any) {
          billingLogger.warn('Could not dispatch single invoice email', {
            invoiceNumber,
            clientEmail: schedule.client_email,
            error: mailErr?.message,
          });
        }
      }

      return {
        success: true,
        invoiceId: createdInvoice.id,
        invoiceNumber,
        publicToken: createdInvoice.public_token,
        totalAmount,
        emailSent,
      };
    } catch (err: any) {
      billingLogger.error('generateSingleInvoice error', { scheduleId, error: err?.message });
      return { success: false, error: err?.message };
    }
  }

  /**
   * Generate sequential invoices for accrued billing intervals between startDate and today
   */
  async generateAccruedInvoices(
    scheduleId: string,
    tenantId: string,
    cyclesToGenerate?: BillingCycleInfo[]
  ): Promise<{
    generatedCount: number;
    invoices: any[];
    latestInvoiceId: string | null;
  }> {
    const generatedInvoices: any[] = [];

    try {
      const scheduleRes = await query(`
        SELECT 
          m.*,
          t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone,
          t.address as tenant_address, t.city as tenant_city, t.kra_pin as tenant_kra_pin,
          t.logo_url as tenant_logo_url, t.primary_color as tenant_primary_color,
          t.invoice_prefix as tenant_invoice_prefix, t.invoice_template as tenant_invoice_template,
          t.display_fields as tenant_display_fields, t.bank_details as tenant_bank_details,
          t.daraja_shortcode as tenant_daraja_shortcode, t.daraja_shortcode_type as tenant_daraja_shortcode_type,
          c.name as client_name, c.email as client_email, c.phone as client_phone,
          c.address as client_address, c.city as client_city, c.kra_pin as client_kra_pin,
          p.name as project_name, p.code as project_code
        FROM maintenance_schedules m
        JOIN tenants t ON m.tenant_id = t.id
        JOIN clients c ON m.client_id = c.id
        LEFT JOIN projects p ON m.project_id = p.id
        WHERE m.id = $1 AND m.tenant_id = $2
      `, [scheduleId, tenantId]);

      const schedule = scheduleRes.rows[0];
      if (!schedule) {
        return { generatedCount: 0, invoices: [], latestInvoiceId: null };
      }

      let cycles = cyclesToGenerate;
      if (!cycles || cycles.length === 0) {
        const calc = this.calculateBillingCycles(
          new Date(schedule.startdate || schedule.startDate),
          schedule.frequency,
          schedule.interval_months,
          schedule.end_date ? new Date(schedule.end_date) : null
        );
        cycles = calc.elapsedCycles;
      }

      if (!cycles || cycles.length === 0) {
        return { generatedCount: 0, invoices: [], latestInvoiceId: null };
      }

      const chargeAmount = parseFloat(String(schedule.charge_amount)) || 0;
      const taxRate = parseFloat(String(schedule.tax_rate ?? 16)) || 0;
      const taxAmount = taxRate > 0 ? chargeAmount * (taxRate / 100) : 0;
      const totalAmount = chargeAmount + taxAmount;
      let latestInvoiceId: string | null = null;

      for (const cycle of cycles) {
        const invoiceNumber = await this.getNextInvoiceNumber(
          schedule.tenant_id,
          schedule.tenant_invoice_prefix || 'INV'
        );

        const periodStr = `${cycle.periodStart.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })} - ${cycle.periodEnd.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        const invoiceTitle = `${schedule.title} (${periodStr})`;
        const invoiceNotes = schedule.notes
          ? `${schedule.notes}\nBilling Period: ${periodStr} (${schedule.frequency}).`
          : `Recurring maintenance retainer for period: ${periodStr} (${schedule.frequency}).`;

        const invoiceInsertSql = `
          INSERT INTO invoices (
            id, tenant_id, client_id, project_id, recurring_schedule_id,
            invoice_number, title, status, issue_date, due_date,
            subtotal, tax_amount, discount_amount, total_amount, amount_paid, balance_due,
            notes, terms, template, tenant_kra_pin, client_kra_pin, public_token, created_at, updated_at
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4,
            $5, $6, 'SENT', $7, $8,
            $9, $10, 0, $11, 0, $11,
            $12, $13, $14, $15, $16, gen_random_uuid()::text, NOW(), NOW()
          )
          RETURNING *
        `;

        const invoiceRes = await query(invoiceInsertSql, [
          schedule.tenant_id,
          schedule.client_id,
          schedule.project_id || null,
          schedule.id,
          invoiceNumber,
          invoiceTitle,
          cycle.dueDate,
          cycle.dueDate,
          chargeAmount,
          taxAmount,
          totalAmount,
          invoiceNotes,
          'Payment is due upon receipt. M-Pesa and Card payments accepted.',
          schedule.tenant_invoice_template || 'modern',
          schedule.tenant_kra_pin || 'P000000000X',
          schedule.client_kra_pin || null,
        ]);

        const createdInvoice = invoiceRes.rows[0];
        latestInvoiceId = createdInvoice.id;

        // Insert item
        await query(
          `INSERT INTO invoice_items (
            id, invoice_id, description, quantity, unit_price, discount_percent,
            tax_type, tax_rate, line_total, line_tax, sort_order
          ) VALUES (
            gen_random_uuid()::text, $1, $2, 1, $3, 0,
            $4, $5, $6, $7, 1
          )`,
          [
            createdInvoice.id,
            invoiceTitle,
            chargeAmount,
            schedule.tax_type || 'VAT_16',
            taxRate,
            totalAmount,
            taxAmount,
          ]
        );

        generatedInvoices.push(createdInvoice);
      }

      if (latestInvoiceId) {
        await query(
          `UPDATE maintenance_schedules 
           SET last_completed_date = NOW(),
               last_invoice_id = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [latestInvoiceId, schedule.id]
        );
      }

      billingLogger.info(`Generated ${generatedInvoices.length} accrued past invoices for schedule ${schedule.id}`);
      return {
        generatedCount: generatedInvoices.length,
        invoices: generatedInvoices,
        latestInvoiceId,
      };
    } catch (err: any) {
      billingLogger.error('generateAccruedInvoices error', { scheduleId, error: err?.message });
      return { generatedCount: 0, invoices: [], latestInvoiceId: null };
    }
  }
}

export const recurringBillingService = new RecurringBillingService();
export default recurringBillingService;
