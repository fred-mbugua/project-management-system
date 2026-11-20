// ══════════════════════════════════════════════════════════════════════
// Maintenance Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import {
  MaintenanceFrequency,
  MaintenanceStatus,
  TaxType,
  UserRole,
  AuditAction,
} from '../models/types';
import { MaintenanceModel, MaintenanceContractDetail } from '../models/maintenance.model';
import ActionLogService from '../services/actionLog.service';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { formatKES } from '../utils/taxCalculator';
import { recurringBillingService } from '../services/recurringBilling.service';
import { isAssignedProjectsOnly } from '../middleware/rbac';
import logger from '../utils/logger';

const maintLogger = logger.child('MaintenanceController');

const VALID_FREQUENCIES = new Set<string>(Object.values(MaintenanceFrequency));
const VALID_STATUSES = new Set<string>(Object.values(MaintenanceStatus));

const FREQUENCY_DEFAULT_MONTHS: Record<string, number> = {
  [MaintenanceFrequency.MONTHLY]: 1,
  [MaintenanceFrequency.QUARTERLY]: 3,
  [MaintenanceFrequency.BIANNUAL]: 6,
  [MaintenanceFrequency.ANNUAL]: 12,
  [MaintenanceFrequency.WEEKLY]: 1,
  [MaintenanceFrequency.BIWEEKLY]: 1,
};

function parseDateValue(raw: unknown): Date | null {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const parsed = new Date(String(raw).trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class MaintenanceController {
  private async verifyScheduleAccess(
    req: Request,
    id: string
  ): Promise<{ schedule: MaintenanceContractDetail | null; isSuper: boolean; denied: boolean }> {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const tenantId = req.tenantId;

    if (!tenantId && !isSuper) {
      return { schedule: null, isSuper, denied: true };
    }

    const schedule = await MaintenanceModel.findByIdAndTenant(
      id,
      isSuper ? null : (tenantId || null)
    );
    if (!schedule) {
      return { schedule: null, isSuper, denied: false };
    }

    if (req.user && isAssignedProjectsOnly(req.user)) {
      if (!schedule.projectId) {
        return { schedule: null, isSuper, denied: true };
      }
      const pCheck = await query(
        `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
         UNION
         SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2
         LIMIT 1`,
        [schedule.projectId, req.user.id]
      );
      if ((pCheck.rowCount || 0) === 0) {
        return { schedule: null, isSuper, denied: true };
      }
    }

    return { schedule, isSuper, denied: false };
  }

  private async isProjectAssignedToUser(projectId: string, userId: string): Promise<boolean> {
    const pCheck = await query(
      `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
       UNION
       SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2
       LIMIT 1`,
      [projectId, userId]
    );
    return (pCheck.rowCount || 0) > 0;
  }
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

      if (params.status && VALID_STATUSES.has(params.status)) {
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
   * Render edit maintenance contract form
   */
  showEdit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const access = await this.verifyScheduleAccess(req, id);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.schedule) {
        req.flash(
          'error',
          access.denied
            ? 'You do not have permission to edit this maintenance contract.'
            : 'Maintenance contract not found.'
        );
        res.redirect('/maintenance');
        return;
      }

      const schedule = access.schedule;
      const isScoped = req.user ? isAssignedProjectsOnly(req.user) : false;

      const projectsQuery = isScoped && req.user
        ? query(
            `SELECT id, name, code, status FROM projects
             WHERE tenant_id = $1 AND (status != 'CANCELLED' OR id = $2) AND (
               EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = projects.id AND pm.user_id = $3)
               OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = projects.id AND t.assigned_to_id = $3)
             )
             ORDER BY name ASC`,
            [schedule.tenantId, schedule.projectId || null, req.user.id]
          )
        : query(
            `SELECT id, name, code, status FROM projects
             WHERE tenant_id = $1 AND (status != 'CANCELLED' OR id = $2)
             ORDER BY name ASC`,
            [schedule.tenantId, schedule.projectId || null]
          );

      const [clientsRes, projectsRes] = await Promise.all([
        query(
          `SELECT id, name, is_active FROM clients
           WHERE tenant_id = $1 AND (is_active = TRUE OR id = $2)
           ORDER BY name ASC`,
          [schedule.tenantId, schedule.clientId]
        ),
        projectsQuery,
      ]);

      res.render('pages/maintenance/edit', {
        title: `Edit ${schedule.title}`,
        schedule,
        clients: clientsRes.rows,
        projects: projectsRes.rows,
        frequencies: Object.values(MaintenanceFrequency),
        statuses: Object.values(MaintenanceStatus),
        formatKES,
      });
    } catch (error) {
      maintLogger.error('Failed to load edit maintenance contract page', { error: String(error) });
      next(error);
    }
  };

  /**
   * Update maintenance contract details, cadence, and billing settings
   */
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const access = await this.verifyScheduleAccess(req, id);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.schedule) {
        req.flash(
          'error',
          access.denied
            ? 'You do not have permission to update this maintenance contract.'
            : 'Maintenance contract not found.'
        );
        res.redirect('/maintenance');
        return;
      }

      const existing = access.schedule;
      const {
        title,
        clientId,
        projectId,
        frequency,
        intervalMonths,
        status,
        chargeAmount,
        taxRate,
        startDate,
        nextDueDate,
        endDate,
        notifyDaysBefore,
        autoInvoice,
        autoSendEmail,
        notes,
      } = req.body;

      const trimmedTitle = typeof title === 'string' ? title.trim() : '';
      if (!trimmedTitle || trimmedTitle.length > 255) {
        req.flash('error', 'Contract title is required and must be 255 characters or less.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      const cleanClientId = typeof clientId === 'string' ? clientId.trim() : '';
      if (!cleanClientId) {
        req.flash('error', 'Please select a client.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      const clientCheck = await query(
        `SELECT id FROM clients WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [cleanClientId, existing.tenantId]
      );
      if ((clientCheck.rowCount || 0) === 0) {
        req.flash('error', 'Selected client does not belong to this organization.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      const cleanProjectId = typeof projectId === 'string' && projectId.trim() !== '' ? projectId.trim() : null;
      if (cleanProjectId) {
        const projCheck = await query(
          `SELECT id FROM projects WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [cleanProjectId, existing.tenantId]
        );
        if ((projCheck.rowCount || 0) === 0) {
          req.flash('error', 'Selected project does not belong to this organization.');
          res.redirect(`/maintenance/${id}/edit`);
          return;
        }
        if (req.user && isAssignedProjectsOnly(req.user)) {
          if (!(await this.isProjectAssignedToUser(cleanProjectId, req.user.id))) {
            req.flash('error', 'You can only link maintenance contracts to projects assigned to you.');
            res.redirect(`/maintenance/${id}/edit`);
            return;
          }
        }
      } else if (req.user && isAssignedProjectsOnly(req.user)) {
        req.flash('error', 'A linked assigned project is required for your account scope.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      if (!VALID_FREQUENCIES.has(frequency)) {
        req.flash('error', 'Invalid billing cadence selected.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }
      const normalizedFrequency = frequency as MaintenanceFrequency;

      const normalizedStatus = VALID_STATUSES.has(status)
        ? (status as MaintenanceStatus)
        : existing.status;

      let parsedInterval = FREQUENCY_DEFAULT_MONTHS[normalizedFrequency] ?? 1;
      if (normalizedFrequency === MaintenanceFrequency.CUSTOM) {
        const rawInt = parseInt(String(intervalMonths || ''), 10);
        if (!Number.isFinite(rawInt) || rawInt < 1 || rawInt > 120) {
          req.flash('error', 'Custom interval months must be a whole number between 1 and 120.');
          res.redirect(`/maintenance/${id}/edit`);
          return;
        }
        parsedInterval = rawInt;
      }

      const parsedCharge = Number(chargeAmount);
      if (chargeAmount === undefined || chargeAmount === null || String(chargeAmount).trim() === '' || !Number.isFinite(parsedCharge) || parsedCharge < 0) {
        req.flash('error', 'Retainer amount must be a valid non-negative number.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      const parsedTaxRate =
        taxRate === undefined || taxRate === null || String(taxRate).trim() === ''
          ? 0
          : Number(taxRate);
      if (!Number.isFinite(parsedTaxRate) || parsedTaxRate < 0 || parsedTaxRate > 100) {
        req.flash('error', 'Tax / VAT rate must be between 0% and 100%.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      const parsedTaxType =
        parsedTaxRate === 0
          ? (existing.taxType === TaxType.EXEMPT ? TaxType.EXEMPT : TaxType.ZERO_RATED)
          : parsedTaxRate === 16
          ? TaxType.VAT_16
          : TaxType.CUSTOM;

      const startDt = parseDateValue(startDate);
      const nextDueDt = parseDateValue(nextDueDate);
      if (!startDt || !nextDueDt) {
        req.flash('error', 'Valid Billing Start Date and Next Invoice Due Date are required.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      let endDt: Date | null = null;
      if (endDate !== undefined && endDate !== null && String(endDate).trim() !== '') {
        endDt = parseDateValue(endDate);
        if (!endDt) {
          req.flash('error', 'Please enter a valid Contract End Date.');
          res.redirect(`/maintenance/${id}/edit`);
          return;
        }
        if (endDt < startDt) {
          req.flash('error', 'Contract End Date cannot be earlier than Billing Start Date.');
          res.redirect(`/maintenance/${id}/edit`);
          return;
        }
      }

      const parsedNotifyDays =
        notifyDaysBefore === undefined || notifyDaysBefore === null || String(notifyDaysBefore).trim() === ''
          ? existing.notifyDaysBefore
          : parseInt(String(notifyDaysBefore), 10);
      if (!Number.isFinite(parsedNotifyDays) || parsedNotifyDays < 0 || parsedNotifyDays > 365) {
        req.flash('error', 'Invoice lead days must be between 0 and 365.');
        res.redirect(`/maintenance/${id}/edit`);
        return;
      }

      const willAutoInvoice = autoInvoice === 'on' || autoInvoice === true || autoInvoice === 'true';
      const willAutoEmail = autoSendEmail === 'on' || autoSendEmail === true || autoSendEmail === 'true';
      const cleanNotes = typeof notes === 'string' && notes.trim() !== '' ? notes.trim() : null;

      const updated = await MaintenanceModel.update(
        id,
        access.isSuper ? null : existing.tenantId,
        {
          clientId: cleanClientId,
          projectId: cleanProjectId,
          title: trimmedTitle,
          frequency: normalizedFrequency,
          intervalMonths: parsedInterval,
          status: normalizedStatus,
          chargeAmount: parsedCharge,
          taxType: parsedTaxType,
          taxRate: parsedTaxRate,
          startDate: startDt,
          nextDueDate: nextDueDt,
          endDate: endDt,
          autoInvoice: willAutoInvoice,
          autoSendEmail: willAutoEmail,
          notifyDaysBefore: parsedNotifyDays,
          notes: cleanNotes,
        }
      );

      if (!updated) {
        req.flash('error', 'Maintenance contract could not be updated.');
        res.redirect('/maintenance');
        return;
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'MAINTENANCE_SCHEDULE',
        entityId: id,
        description: `Updated maintenance contract "${updated.title}"`,
        metadata: {
          before: {
            title: existing.title,
            clientId: existing.clientId,
            projectId: existing.projectId,
            frequency: existing.frequency,
            intervalMonths: existing.intervalMonths,
            status: existing.status,
            chargeAmount: existing.chargeAmount,
            taxRate: existing.taxRate,
            nextDueDate: existing.nextDueDate,
          },
          after: {
            title: updated.title,
            clientId: updated.clientId,
            projectId: updated.projectId,
            frequency: updated.frequency,
            intervalMonths: updated.intervalMonths,
            status: updated.status,
            chargeAmount: updated.chargeAmount,
            taxRate: updated.taxRate,
            nextDueDate: updated.nextDueDate,
          },
        },
      });

      req.flash('success', `Maintenance contract "${updated.title}" updated successfully.`);
      res.redirect('/maintenance');
    } catch (error) {
      maintLogger.error('Failed to update maintenance contract', { error: String(error) });
      next(error);
    }
  };

  /**
   * Toggle contract status between ACTIVE and PAUSED
   */
  toggleStatus = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const access = await this.verifyScheduleAccess(req, id);
      if (!access.schedule) {
        req.flash('error', access.denied ? 'Permission denied.' : 'Contract not found.');
        res.redirect('/maintenance');
        return;
      }

      const nextStatus = access.schedule.status === MaintenanceStatus.ACTIVE
        ? MaintenanceStatus.PAUSED
        : MaintenanceStatus.ACTIVE;

      await query(
        `UPDATE maintenance_schedules 
         SET status = $1::maintenance_status,
             updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [nextStatus, id, access.schedule.tenantId]
      );

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'MAINTENANCE_SCHEDULE',
        entityId: id,
        description: `Changed contract "${access.schedule.title}" status from ${access.schedule.status} to ${nextStatus}`,
        metadata: { previousStatus: access.schedule.status, newStatus: nextStatus },
      });

      req.flash('success', `Contract status updated to ${nextStatus}.`);
      res.redirect('/maintenance');
    } catch (error) {
      req.flash('error', 'Failed to update contract status.');
      res.redirect('/maintenance');
    }
  };

  /**
   * Delete schedule
   */
  deleteSchedule = async (req: Request, res: Response, _next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const access = await this.verifyScheduleAccess(req, id);
      if (!access.schedule) {
        req.flash('error', access.denied ? 'Permission denied.' : 'Contract not found.');
        res.redirect('/maintenance');
        return;
      }

      await ActionLogService.record(req, {
        action: AuditAction.DELETE,
        entityType: 'MAINTENANCE_SCHEDULE',
        entityId: id,
        description: `Deleted maintenance contract "${access.schedule.title}"`,
        metadata: {
          title: access.schedule.title,
          clientId: access.schedule.clientId,
          chargeAmount: access.schedule.chargeAmount,
          frequency: access.schedule.frequency,
        },
      });

      await query(
        `DELETE FROM maintenance_schedules WHERE id = $1 AND tenant_id = $2`,
        [id, access.schedule.tenantId]
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

