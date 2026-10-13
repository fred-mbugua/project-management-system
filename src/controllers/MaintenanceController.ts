// ══════════════════════════════════════════════════════════════════════
// Maintenance Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { MaintenanceFrequency, MaintenanceStatus } from '../models/types';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { formatKES } from '../utils/taxCalculator';
import { recurringBillingService } from '../services/recurringBilling.service';
import { isAssignedProjectsOnly } from '../middleware/rbac';
import logger from '../utils/logger';

const maintLogger = logger.child('MaintenanceController');

export class MaintenanceController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const params = extractPaginationParams(req, 10);
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (tenantId && !isSuper) {
        conditions.push(`m.tenant_id = $${paramIdx++}`);
        values.push(tenantId);
      }

      // Restrict to maintenance linked to assigned projects if user is scoped
      if (req.user && isAssignedProjectsOnly(req.user)) {
        conditions.push(`(
          m.project_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = m.project_id AND pm.user_id = $${paramIdx})
            OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = m.project_id AND t.assigned_to_id = $${paramIdx})
          )
        )`);
        values.push(req.user.id);
        paramIdx++;
      }

      if (params.search) {
        conditions.push(`(
          m.title ILIKE $${paramIdx} OR
          m.notes ILIKE $${paramIdx} OR
          c.name ILIKE $${paramIdx} OR
          p.name ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`m.created_at >= $${paramIdx++}::timestamptz`);
        values.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        conditions.push(`m.created_at <= $${paramIdx++}::timestamptz`);
        values.push(`${params.endDate}T23:59:59Z`);
      }

      if (params.status) {
        conditions.push(`m.status = $${paramIdx++}`);
        values.push(params.status);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countSql = `
        SELECT COUNT(*)::int as total
        FROM maintenance_schedules m
        JOIN clients c ON m.client_id = c.id
        LEFT JOIN projects p ON m.project_id = p.id
        ${whereClause}
      `;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

      const dataSql = `
        SELECT 
          m.*,
          c.name as client_name,
          c.phone as client_phone,
          c.email as client_email,
          p.name as project_name,
          p.code as project_code,
          inv.invoice_number as last_invoice_number,
          inv.public_token as last_invoice_token,
          inv.status as last_invoice_status,
          (
            SELECT COUNT(*)::int 
            FROM invoices i 
            WHERE i.recurring_schedule_id = m.id
          ) as invoice_count,
          (
            SELECT COALESCE(json_agg(json_build_object(
              'id', i.id,
              'invoice_number', i.invoice_number,
              'title', i.title,
              'due_date', i.due_date,
              'issue_date', i.issue_date,
              'total_amount', i.total_amount,
              'amount_paid', i.amount_paid,
              'balance_due', i.balance_due,
              'status', i.status,
              'public_token', i.public_token,
              'notes', i.notes,
              'terms', i.terms,
              'template', i.template,
              'custom_color', i.custom_color
            ) ORDER BY i.due_date ASC, i.created_at ASC), '[]'::json)
            FROM invoices i
            WHERE i.recurring_schedule_id = m.id
          ) as schedule_invoices
        FROM maintenance_schedules m
        JOIN clients c ON m.client_id = c.id
        LEFT JOIN projects p ON m.project_id = p.id
        LEFT JOIN invoices inv ON m.last_invoice_id = inv.id
        ${whereClause}
        ORDER BY m.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];

      const isScoped = req.user ? isAssignedProjectsOnly(req.user) : false;
      const projectsQuery = isScoped && req.user
        ? query(
            `SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' AND (
              EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = projects.id AND pm.user_id = $2)
              OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = projects.id AND t.assigned_to_id = $2)
            ) ORDER BY name ASC`,
            [tenantId, req.user.id]
          )
        : tenantId
        ? query(`SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' ORDER BY name ASC`, [tenantId])
        : query(`SELECT id, name, code FROM projects WHERE status != 'CANCELLED' ORDER BY name ASC`);

      const [schedulesRes, clientsRes, projectsRes, statsRes] = await Promise.all([
        query(dataSql, dataValues),
        tenantId
          ? query(`SELECT id, name FROM clients WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name ASC`, [tenantId])
          : query(`SELECT id, name FROM clients WHERE is_active = TRUE ORDER BY name ASC`),
        projectsQuery,
        tenantId
          ? query(`
              SELECT 
                COUNT(*) FILTER (WHERE status = 'ACTIVE')::int as active_count,
                COALESCE(SUM(charge_amount) FILTER (WHERE status = 'ACTIVE'), 0)::numeric as total_mrr,
                COUNT(*)::int as total_schedules
              FROM maintenance_schedules
              WHERE tenant_id = $1
            `, [tenantId])
          : query(`
              SELECT 
                COUNT(*) FILTER (WHERE status = 'ACTIVE')::int as active_count,
                COALESCE(SUM(charge_amount) FILTER (WHERE status = 'ACTIVE'), 0)::numeric as total_mrr,
                COUNT(*)::int as total_schedules
              FROM maintenance_schedules
            `),
      ]);

      const statData = statsRes.rows[0] || { active_count: 0, total_mrr: 0, total_schedules: 0 };
      const pagination = calculatePagination(total, params, req);

      res.render('pages/maintenance/index', {
        title: 'Maintenance & Recurring Contracts',
        schedules: schedulesRes.rows,
        clients: clientsRes.rows,
        projects: projectsRes.rows,
        frequencies: Object.values(MaintenanceFrequency),
        stats: {
          activeCount: statData.active_count || 0,
          totalMRR: parseFloat(statData.total_mrr || 0),
          totalSchedules: statData.total_schedules || 0,
        },
        pagination,
        filters: params,
        formatKES,
      });
    } catch (error) {
      maintLogger.error('Failed to list maintenance schedules', { error: String(error) });
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      let tenantId = req.tenantId;
      if (!tenantId && isSuper) {
        const first = await query('SELECT id FROM tenants WHERE is_active = TRUE LIMIT 1');
        tenantId = first.rows[0]?.id;
      }
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const {
        title,
        clientId,
        projectId,
        frequency,
        intervalMonths,
        chargeAmount,
        taxRate,
        startDate,
        nextDueDate,
        endDate,
        autoSendEmail,
        notes,
        generatePastInvoices,
      } = req.body;

      if (!title || !clientId || !chargeAmount || (!startDate && !nextDueDate)) {
        req.flash('error', 'Title, Client, Retainer Amount, and Billing Start Date are required.');
        res.redirect('/maintenance');
        return;
      }

      if (projectId && req.user && isAssignedProjectsOnly(req.user)) {
        const pCheck = await query(
          `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
           UNION
           SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2`,
          [projectId, req.user.id]
        );
        if (pCheck.rowCount === 0) {
          req.flash('error', 'You can only create maintenance contracts for projects assigned to you.');
          res.redirect('/maintenance');
          return;
        }
      }

      const parsedInterval = parseInt(String(intervalMonths || '1'), 10) || 1;
      const parsedTaxRate = parseFloat(String(taxRate ?? 16)) || 0;
      const willAutoEmail = autoSendEmail === 'on' || autoSendEmail === true || autoSendEmail === 'true';
      const parsedFrequency = frequency || MaintenanceFrequency.MONTHLY;

      const startDt = new Date(startDate || nextDueDate);
      const endDt = endDate ? new Date(endDate) : null;

      // Calculate sequential billing cycles and check for elapsed intervals
      const billingCalc = recurringBillingService.calculateBillingCycles(
        startDt,
        parsedFrequency,
        parsedInterval,
        endDt
      );

      // Determine the initial next_due_date:
      // If there are upcoming future cycles, the next due date is the earliest upcoming cycle.
      // If no upcoming cycles (all in past up to end date), next_due_date is the calculated nextDueDate.
      const effectiveNextDueDate = billingCalc.upcomingCycles.length > 0
        ? billingCalc.upcomingCycles[0].dueDate
        : (billingCalc.nextDueDate || new Date(nextDueDate || startDt));

      const sql = `
        INSERT INTO maintenance_schedules (
          id, tenant_id, client_id, project_id, title, frequency, interval_months,
          status, charge_amount, tax_rate, startdate, next_due_date, end_date,
          auto_send_email, auto_invoice, notes, updated_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, $6,
          'ACTIVE', $7, $8, $9, $10, $11,
          $12, TRUE, $13, NOW()
        )
        RETURNING id
      `;

      const insertRes = await query(sql, [
        tenantId,
        clientId,
        projectId || null,
        title,
        parsedFrequency,
        parsedInterval,
        parseFloat(chargeAmount) || 0,
        parsedTaxRate,
        startDt,
        effectiveNextDueDate,
        endDt,
        willAutoEmail,
        notes || null,
      ]);

      const scheduleId = insertRes.rows[0].id;

      // Handle accrued past invoices generation if requested
      const willGeneratePast = generatePastInvoices === 'on' || generatePastInvoices === true || generatePastInvoices === 'true';
      let accruedCount = 0;
      let accruedInvoiceNumbers: string[] = [];

      if (willGeneratePast && billingCalc.elapsedCycles.length > 0) {
        const accruedRes = await recurringBillingService.generateAccruedInvoices(
          scheduleId,
          tenantId,
          billingCalc.elapsedCycles
        );
        accruedCount = accruedRes.generatedCount;
        accruedInvoiceNumbers = accruedRes.invoices.map((inv: any) => inv.invoice_number);
      }

      if (accruedCount > 0) {
        req.flash(
          'success',
          `Recurring maintenance contract scheduled successfully! Generated ${accruedCount} accrued past invoice(s) (${accruedInvoiceNumbers.join(', ')}) with their respective due dates. Next automated cycle is scheduled for ${effectiveNextDueDate.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })}.`
        );
      } else {
        req.flash(
          'success',
          `Recurring maintenance contract scheduled successfully. Invoices will be auto-generated according to your cadence (Next Due: ${effectiveNextDueDate.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })}).`
        );
      }

      res.redirect('/maintenance');
    } catch (error) {
      maintLogger.error('Failed to create maintenance schedule', { error: String(error) });
      next(error);
    }
  };

  /**
   * Get all invoices generated for a specific maintenance schedule (API endpoint)
   */
  getContractInvoices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let sql = `
        SELECT 
          i.id, i.invoice_number, i.title, i.status, i.due_date, i.issue_date,
          i.total_amount, i.amount_paid, i.balance_due, i.public_token,
          i.notes, i.terms, i.template, i.custom_color,
          c.name as client_name, c.email as client_email
        FROM invoices i
        JOIN clients c ON i.client_id = c.id
        WHERE i.recurring_schedule_id = $1
      `;
      const params: any[] = [id];
      if (tenantId && !isSuper) {
        sql += ` AND i.tenant_id = $2`;
        params.push(tenantId);
      }
      sql += ` ORDER BY i.due_date ASC, i.created_at ASC`;

      const result = await query(sql, params);
      res.json({
        success: true,
        invoices: result.rows,
      });
    } catch (error) {
      maintLogger.error('Failed to get contract invoices', { error: String(error) });
      next(error);
    }
  };

  /**
   * Run automated billing scan manually right now
   */
  triggerAutoBilling = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const result = await recurringBillingService.runAutoBilling(tenantId || undefined);

      if (result.invoicesGenerated > 0) {
        req.flash(
          'success',
          `Automated billing cycle completed: Generated ${result.invoicesGenerated} invoices and dispatched ${result.emailsSent} emails with instant payment links.`
        );
      } else {
        req.flash(
          'info',
          `Automated billing engine ran: Checked ${result.schedulesChecked} recurring contracts. No contracts are currently due for invoicing.`
        );
      }
      res.redirect('/maintenance');
    } catch (error) {
      maintLogger.error('Failed to trigger auto billing', { error: String(error) });
      req.flash('error', 'Failed to trigger automated billing engine.');
      res.redirect('/maintenance');
    }
  };

  /**
   * Generate an invoice for a specific contract immediately
   */
  generateInvoiceNow = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const result = await recurringBillingService.generateSingleInvoice(id, tenantId || undefined);

      if (result.success) {
        req.flash(
          'success',
          `Invoice ${result.invoiceNumber} successfully generated and emailed! Cadence has been advanced to next cycle.`
        );
      } else {
        req.flash('error', result.error || 'Failed to generate recurring invoice.');
      }
      res.redirect('/maintenance');
    } catch (error) {
      maintLogger.error('Failed to generate invoice for contract', { error: String(error) });
      req.flash('error', 'Error generating invoice.');
      res.redirect('/maintenance');
    }
  };

  /**
   * Toggle contract status between ACTIVE and PAUSED
   */
  toggleStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      await query(
        `UPDATE maintenance_schedules 
         SET status = CASE WHEN status = 'ACTIVE' THEN 'PAUSED' ELSE 'ACTIVE' END,
             updated_at = NOW()
         WHERE id = $1 AND ($2::text IS NULL OR tenant_id = $2)`,
        [id, tenantId || null]
      );
      req.flash('success', 'Contract status updated.');
      res.redirect('/maintenance');
    } catch (error) {
      req.flash('error', 'Failed to update contract status.');
      res.redirect('/maintenance');
    }
  };

  /**
   * Delete schedule
   */
  deleteSchedule = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      await query(
        `DELETE FROM maintenance_schedules WHERE id = $1 AND ($2::text IS NULL OR tenant_id = $2)`,
        [id, tenantId || null]
      );
      req.flash('success', 'Maintenance contract deleted.');
      res.redirect('/maintenance');
    } catch (error) {
      req.flash('error', 'Failed to delete contract.');
      res.redirect('/maintenance');
    }
  };
}

export default new MaintenanceController();

