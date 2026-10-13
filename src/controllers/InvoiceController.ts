// ══════════════════════════════════════════════════════════════════════
// Invoice Controller - Raw PostgreSQL Queries
// Invoicing, tax calculations, and eTIMS compliance
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { InvoiceModel, InvoiceStatus, TaxType, AuditAction } from '../models';
import { calculateInvoiceTotals, generateEtimsHash, generateEtimsQrPayload, formatKES } from '../utils/taxCalculator';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { isAssignedProjectsOnly } from '../middleware/rbac';
import pdfService from '../services/pdf.service';
import storageService from '../services/storage.service';
import ActionLogService from '../services/actionLog.service';
import logger from '../utils/logger';

const invoiceLogger = logger.child('InvoiceController');

export class InvoiceController {
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
        conditions.push(`i.tenant_id = $${paramIdx++}`);
        values.push(tenantId);
      }

      // Restrict to invoices linked to assigned projects if user is scoped
      if (req.user && isAssignedProjectsOnly(req.user)) {
        conditions.push(`(
          i.project_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = i.project_id AND pm.user_id = $${paramIdx})
            OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = i.project_id AND t.assigned_to_id = $${paramIdx})
          )
        )`);
        values.push(req.user.id);
        paramIdx++;
      }

      if (params.search) {
        conditions.push(`(
          i.invoice_number ILIKE $${paramIdx} OR 
          c.name ILIKE $${paramIdx} OR 
          i.title ILIKE $${paramIdx} OR
          p.name ILIKE $${paramIdx} OR
          i.notes ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`i.created_at >= $${paramIdx++}::timestamptz`);
        values.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        conditions.push(`i.created_at <= $${paramIdx++}::timestamptz`);
        values.push(`${params.endDate}T23:59:59Z`);
      }

      if (params.status) {
        conditions.push(`i.status = $${paramIdx++}`);
        values.push(params.status);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total for pagination
      const countSql = `
        SELECT COUNT(*)::int as total
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN projects p ON i.project_id = p.id
        ${whereClause}
      `;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

      // Newest always at the top: ORDER BY i.created_at DESC
      const dataSql = `
        SELECT 
          i.*,
          c.name as client_name,
          p.name as project_name,
          p.code as project_code
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN projects p ON i.project_id = p.id
        ${whereClause}
        ORDER BY i.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];
      const result = await query(dataSql, dataValues);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/invoices/index', {
        title: 'Invoices',
        invoices: result.rows,
        pagination,
        filters: params,
        formatKES,
      });
    } catch (error) {
      invoiceLogger.error('Failed to list invoices', { error: String(error) });
      next(error);
    }
  };

  showNew = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if ((req as any).isSubscriptionCancelled) {
        req.flash('error', 'Your subscription is cancelled. Creating new transactions is disabled until your subscription is renewed.');
        res.redirect('/subscription/pay');
        return;
      }

      const tenantId = req.tenantId;
      const isScoped = req.user ? isAssignedProjectsOnly(req.user) : false;
      const projectsQuery = isScoped && req.user
        ? query(
            `SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' AND (
              EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = projects.id AND pm.user_id = $2)
              OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = projects.id AND t.assigned_to_id = $2)
            ) ORDER BY name ASC`,
            [tenantId, req.user.id]
          )
        : query(`SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' ORDER BY name ASC`, [tenantId]);

      const [clientsRes, projectsRes] = await Promise.all([
        query(`SELECT id, name, kra_pin FROM clients WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name ASC`, [tenantId]),
        projectsQuery,
      ]);

      // Generate invoice number preview
      const countRes = await query(`SELECT COUNT(*)::int as count FROM invoices WHERE tenant_id = $1`, [tenantId]);
      const nextNum = (countRes.rows[0]?.count || 0) + 1;
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;

      res.render('pages/invoices/new', {
        title: 'Create Invoice',
        clients: clientsRes.rows,
        projects: projectsRes.rows,
        invoiceNumber,
        tenantVatRegistered: req.tenant?.vatRegistered !== false,
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if ((req as any).isSubscriptionCancelled) {
        req.flash('error', 'Your subscription is cancelled. Creating new transactions is disabled until your subscription is renewed.');
        res.redirect('/subscription/pay');
        return;
      }

      const tenantId = req.tenantId;
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const {
        clientId,
        projectId,
        invoiceNumber,
        title,
        dueDate,
        notes,
        terms,
        itemDescriptions,
        itemQuantities,
        itemUnitPrices,
        includeVat,
      } = req.body;

      if (!clientId || !invoiceNumber || !dueDate) {
        req.flash('error', 'Client, Invoice Number, and Due Date are required.');
        res.redirect('/invoices/new');
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
          req.flash('error', 'You can only create invoices for projects assigned to you.');
          res.redirect('/invoices/new');
          return;
        }
      }

      const applyVat = includeVat === 'true' || includeVat === 'on' || includeVat === '1' || includeVat === true;
      const taxType = applyVat ? TaxType.VAT_16 : TaxType.EXEMPT;
      const taxRate = applyVat ? 16 : 0;

      // Format line items
      const descriptions = Array.isArray(itemDescriptions) ? itemDescriptions : [itemDescriptions];
      const quantities = Array.isArray(itemQuantities) ? itemQuantities : [itemQuantities];
      const unitPrices = Array.isArray(itemUnitPrices) ? itemUnitPrices : [itemUnitPrices];

      const rawItems = [];
      for (let i = 0; i < descriptions.length; i++) {
        if (descriptions[i] && descriptions[i].trim()) {
          rawItems.push({
            description: descriptions[i].trim(),
            quantity: parseFloat(quantities[i]) || 1,
            unitPrice: parseFloat(unitPrices[i]) || 0,
            discountPercent: 0,
            taxType,
            taxRate,
          });
        }
      }

      if (rawItems.length === 0) {
        req.flash('error', 'At least one line item is required.');
        res.redirect('/invoices/new');
        return;
      }

      // Calculate totals using KRA tax engine
      const totals = calculateInvoiceTotals(rawItems);
      const taxAmount = applyVat ? totals.totalTax : 0;
      const grandTotal = applyVat ? totals.grandTotal : totals.subtotal;

      // Get client and tenant PIN for eTIMS
      const clientRes = await query(`SELECT kra_pin FROM clients WHERE id = $1`, [clientId]);
      const clientKraPin = clientRes.rows[0]?.kra_pin || 'P000000000X';
      const tenantKraPin = req.tenant?.kraPin || 'P000000000X';
      const issueDate = new Date();

      const etimsPayloadInput = {
        invoiceNumber,
        issueDate: issueDate.toISOString(),
        tenantKraPin,
        clientKraPin,
        totalAmount: grandTotal,
        taxAmount,
      };

      const etimsHash = generateEtimsHash(etimsPayloadInput);
      const etimsQr = generateEtimsQrPayload(etimsPayloadInput);

      const invoice = await InvoiceModel.create({
        tenantId,
        clientId,
        projectId: projectId || null,
        invoiceNumber,
        title: title || 'Professional Services',
        status: InvoiceStatus.UNPAID,
        issueDate,
        dueDate: new Date(dueDate),
        subtotal: totals.subtotal,
        taxAmount,
        discountAmount: totals.totalDiscount,
        totalAmount: grandTotal,
        amountPaid: 0,
        balanceDue: grandTotal,
        notes: notes || null,
        terms: terms || 'Payment due within 30 days.',
        tenantKraPin,
        clientKraPin,
        includeVat: applyVat,
        etimsVerificationHash: etimsHash,
        etimsQrPayload: etimsQr,
        items: rawItems.map((item, idx) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxType: item.taxType,
          taxRate,
          lineTotal: item.quantity * item.unitPrice * (1 + taxRate / 100),
          lineTax: item.quantity * item.unitPrice * (taxRate / 100),
          sortOrder: idx + 1,
        })),
      });

      // Record Action Log
      await ActionLogService.record(req, {
        action: AuditAction.CREATE,
        entityType: 'INVOICE',
        entityId: invoice.id,
        description: `Created invoice ${invoice.invoiceNumber} for KES ${totals.grandTotal.toLocaleString()}`,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          clientId,
          projectId: projectId || null,
          totalAmount: totals.grandTotal,
        },
      });

      req.flash('success', `Invoice ${invoice.invoiceNumber} created successfully.`);
      res.redirect(`/invoices/${invoice.id}`);
    } catch (error) {
      invoiceLogger.error('Failed to create invoice', { error: String(error) });
      next(error);
    }
  };

  show = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      const invoiceId = req.params.id as string;

      let sql = `
        SELECT i.*, 
               c.name as client_name, c.email as client_email, c.phone as client_phone, c.address as client_address, c.city as client_city, c.kra_pin as client_kra_pin,
               p.name as project_name, p.code as project_code,
               t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone, t.address as tenant_address, t.city as tenant_city, t.kra_pin as tenant_kra_pin, t.logo_url as tenant_logo_url, t.primary_color as tenant_primary_color
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN projects p ON i.project_id = p.id
        LEFT JOIN tenants t ON i.tenant_id = t.id
        WHERE i.id = $1
      `;
      const params: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        sql += ` AND i.tenant_id = $2`;
        params.push(tenantId);
      }
      sql += ` LIMIT 1`;

      const [invoiceRes, itemsRes, paymentsRes] = await Promise.all([
        query(sql, params),
        query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC, id ASC`, [invoiceId]),
        query(`SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC`, [invoiceId]),
      ]);

      const invoice = invoiceRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      // If user is restricted to assigned projects only, verify access
      if (req.user && isAssignedProjectsOnly(req.user)) {
        if (!invoice.project_id) {
          req.flash('error', 'You do not have permission to view this invoice.');
          res.redirect('/invoices');
          return;
        }
        const memberCheck = await query(`
          SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
          UNION
          SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2
          LIMIT 1
        `, [invoice.project_id, req.user.id]);
        if (memberCheck.rows.length === 0) {
          req.flash('error', 'You do not have permission to view this invoice.');
          res.redirect('/invoices');
          return;
        }
      }

      res.render('pages/invoices/show', {
        title: `Invoice ${invoice.invoice_number}`,
        invoice,
        items: itemsRes.rows,
        payments: paymentsRes.rows,
        formatKES,
      });
    } catch (error) {
      invoiceLogger.error('Failed to show invoice', { error: String(error) });
      next(error);
    }
  };

  downloadPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      if ((req as any).isSubscriptionCancelled) {
        req.flash('error', 'Your subscription is cancelled. Downloading and printing invoices is disabled until your subscription is renewed.');
        res.redirect(`/invoices/${invoiceId}`);
        return;
      }

      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;

      let sql = `
        SELECT i.*, 
               c.name as client_name, c.email as client_email, c.phone as client_phone, c.address as client_address, c.city as client_city, c.kra_pin as client_kra_pin,
               p.name as project_name, p.code as project_code,
               t.name as tenant_name, t.email as tenant_email, t.phone as tenant_phone, t.address as tenant_address, t.city as tenant_city, t.kra_pin as tenant_kra_pin, t.logo_url as tenant_logo_url, t.primary_color as tenant_primary_color, t.secondary_color as tenant_secondary_color, t.accent_color as tenant_accent_color, t.bank_details as tenant_bank_details, t.invoice_template as tenant_invoice_template, t.display_fields as tenant_display_fields, t.daraja_shortcode as tenant_daraja_shortcode, t.daraja_shortcode_type as tenant_daraja_shortcode_type
        FROM invoices i
        LEFT JOIN clients c ON i.client_id = c.id
        LEFT JOIN projects p ON i.project_id = p.id
        LEFT JOIN tenants t ON i.tenant_id = t.id
        WHERE i.id = $1
      `;
      const params: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        sql += ` AND i.tenant_id = $2`;
        params.push(tenantId);
      }
      sql += ` LIMIT 1`;

      const [invoiceRes, itemsRes] = await Promise.all([
        query(sql, params),
        query(`SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC, id ASC`, [invoiceId]),
      ]);

      const invoice = invoiceRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      // If user is restricted to assigned projects only, verify access
      if (req.user && isAssignedProjectsOnly(req.user)) {
        if (!invoice.project_id) {
          req.flash('error', 'You do not have permission to download this invoice.');
          res.redirect('/invoices');
          return;
        }
        const memberCheck = await query(`
          SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
          UNION
          SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2
          LIMIT 1
        `, [invoice.project_id, req.user.id]);
        if (memberCheck.rows.length === 0) {
          req.flash('error', 'You do not have permission to download this invoice.');
          res.redirect('/invoices');
          return;
        }
      }

      const selectedTemplate = (req.query.template as string) || invoice.template || invoice.tenant_invoice_template || 'modern';
      const customColor = (req.query.color as string) || invoice.custom_color || invoice.tenant_primary_color || '#4F46E5';

      let displayFields: any = {};
      if (invoice.tenant_display_fields) {
        try {
          displayFields = typeof invoice.tenant_display_fields === 'string'
            ? JSON.parse(invoice.tenant_display_fields)
            : invoice.tenant_display_fields;
        } catch {}
      }

      await pdfService.generateDocumentPdf({
        type: 'invoice',
        documentNumber: invoice.invoice_number,
        title: invoice.title,
        status: invoice.status,
        issueDate: invoice.issue_date,
        dueDateOrValidUntil: invoice.due_date,
        dueDateLabel: 'Due Date',
        notes: invoice.notes,
        terms: invoice.terms,
        template: selectedTemplate,
        customColor,
        displayFields,
        includeVat: invoice.include_vat !== false && parseFloat(invoice.tax_amount) > 0,
        subtotal: invoice.subtotal,
        taxAmount: invoice.tax_amount,
        discountAmount: invoice.discount_amount,
        totalAmount: invoice.total_amount,
        amountPaid: invoice.amount_paid,
        balanceDue: invoice.balance_due,
        etimsHash: invoice.etims_verification_hash,
        tenant: {
          name: invoice.tenant_name || 'Organization',
          email: invoice.tenant_email,
          phone: invoice.tenant_phone,
          address: invoice.tenant_address,
          city: invoice.tenant_city,
          kraPin: invoice.tenant_kra_pin,
          logoUrl: invoice.tenant_logo_url,
          primaryColor: invoice.tenant_primary_color,
          secondaryColor: invoice.tenant_secondary_color,
          accentColor: invoice.tenant_accent_color,
          bankDetails: invoice.tenant_bank_details,
          darajaShortcode: invoice.tenant_daraja_shortcode,
          darajaShortcodeType: invoice.tenant_daraja_shortcode_type,
        },
        client: {
          name: invoice.client_name || 'Client',
          email: invoice.client_email,
          phone: invoice.client_phone,
          address: invoice.client_address,
          city: invoice.client_city,
          kraPin: invoice.client_kra_pin,
        },
        project: invoice.project_name ? { name: invoice.project_name, code: invoice.project_code } : null,
        items: itemsRes.rows.map((it: any) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          lineTax: it.line_tax,
          lineTotal: it.line_total,
        })),
      }, res);
    } catch (error) {
      invoiceLogger.error('Failed to generate invoice PDF', { error: String(error) });
      next(error);
    }
  };

  /**
   * Customize invoice styling, template, due date, notes, terms, or title
   */
  customize = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      const { template, customColor, title, dueDate, notes, terms } = req.body;

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (template) {
        updates.push(`template = $${idx++}`);
        values.push(template);
      }
      if (customColor) {
        updates.push(`custom_color = $${idx++}`);
        values.push(customColor);
      }
      if (title) {
        updates.push(`title = $${idx++}`);
        values.push(title);
      }
      if (dueDate) {
        updates.push(`due_date = $${idx++}`);
        values.push(new Date(dueDate));
      }
      if (notes !== undefined) {
        updates.push(`notes = $${idx++}`);
        values.push(notes);
      }
      if (terms !== undefined) {
        updates.push(`terms = $${idx++}`);
        values.push(terms);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        let sql = `UPDATE invoices SET ${updates.join(', ')} WHERE id = $${idx++}`;
        values.push(invoiceId);

        if (tenantId && !isSuper) {
          sql += ` AND tenant_id = $${idx++}`;
          values.push(tenantId);
        }

        await query(sql, values);
      }

      if (req.xhr || req.headers.accept?.includes('application/json')) {
        res.json({ success: true, message: 'Invoice customized successfully' });
        return;
      }

      req.flash('success', 'Invoice customized successfully.');
      res.redirect(req.header('Referer') || `/invoices/${invoiceId}`);
    } catch (error) {
      invoiceLogger.error('Failed to customize invoice', { error: String(error) });
      next(error);
    }
  };

  /**
   * Toggle VAT inclusion (16% vs 0% Exempt) on an existing invoice
   */
  toggleVat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let findSql = `SELECT * FROM invoices WHERE id = $1`;
      const findParams: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        findSql += ` AND tenant_id = $2`;
        findParams.push(tenantId);
      }
      const invRes = await query(findSql, findParams);
      const invoice = invRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      // Fetch current items
      const itemsRes = await query(
        `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC, id ASC`,
        [invoiceId]
      );
      const items = itemsRes.rows;

      const currentIncludeVat = (invoice.include_vat !== false) && parseFloat(invoice.tax_amount) > 0;
      const newIncludeVat = !currentIncludeVat;
      const newTaxRate = newIncludeVat ? 16 : 0;
      const newTaxType = newIncludeVat ? TaxType.VAT_16 : TaxType.EXEMPT;

      let newSubtotal = 0;
      let newTotalTax = 0;

      for (const item of items) {
        const qty = parseFloat(item.quantity) || 1;
        const price = parseFloat(item.unit_price) || 0;
        const lineTax = newIncludeVat ? (qty * price * 0.16) : 0;
        const lineTotal = newIncludeVat ? (qty * price * 1.16) : (qty * price);

        newSubtotal += (qty * price);
        newTotalTax += lineTax;

        await query(
          `UPDATE invoice_items SET tax_type = $1, tax_rate = $2, line_tax = $3, line_total = $4 WHERE id = $5`,
          [newTaxType, newTaxRate, lineTax, lineTotal, item.id]
        );
      }

      const discountAmount = parseFloat(invoice.discount_amount || 0);
      const newTotalAmount = Math.max(0, newSubtotal + newTotalTax - discountAmount);
      const currentAmountPaid = parseFloat(invoice.amount_paid || 0);
      const newBalanceDue = Math.max(0, newTotalAmount - currentAmountPaid);

      let updateSql = `
        UPDATE invoices 
        SET subtotal = $1, tax_amount = $2, total_amount = $3, balance_due = $4, include_vat = $5, updated_at = NOW() 
        WHERE id = $6
      `;
      const updateParams: any[] = [
        newSubtotal,
        newTotalTax,
        newTotalAmount,
        newBalanceDue,
        newIncludeVat,
        invoiceId,
      ];
      if (tenantId && !isSuper) {
        updateSql += ` AND tenant_id = $7`;
        updateParams.push(tenantId);
      }
      await query(updateSql, updateParams);

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'INVOICE',
        entityId: invoiceId,
        description: `Toggled VAT to ${newIncludeVat ? '16% Standard' : '0% Exempt'} on invoice ${invoice.invoice_number}`,
        metadata: { newIncludeVat, newTotalAmount, newTotalTax },
      });

      req.flash('success', `Invoice VAT updated: ${newIncludeVat ? '16% VAT applied.' : 'VAT removed (0% Exempt).'}`);
      res.redirect(`/invoices/${invoiceId}`);
    } catch (error) {
      invoiceLogger.error('Failed to toggle invoice VAT', { error: String(error) });
      next(error);
    }
  };

  /**
   * Manually update invoice status (e.g. PAID, UNPAID, PARTIALLY_PAID, SENT, OVERDUE, CANCELLED)
   */
  updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const { status } = req.body;

      if (!status) {
        req.flash('error', 'Status is required.');
        res.redirect(`/invoices/${invoiceId}`);
        return;
      }

      // Check invoice exists
      let findSql = `SELECT * FROM invoices WHERE id = $1`;
      const findParams: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        findSql += ` AND tenant_id = $2`;
        findParams.push(tenantId);
      }
      const invRes = await query(findSql, findParams);
      const invoice = invRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      // If marking as PAID and balance remains, update balance_due = 0 and amount_paid = total_amount
      if (status === 'PAID') {
        const totalAmount = parseFloat(invoice.total_amount);
        let updateSql = `UPDATE invoices SET status = $1, amount_paid = $2, balance_due = 0, updated_at = NOW() WHERE id = $3`;
        const updateParams: any[] = [status, totalAmount, invoiceId];
        if (tenantId && !isSuper) {
          updateSql += ` AND tenant_id = $4`;
          updateParams.push(tenantId);
        }
        await query(updateSql, updateParams);
      } else if (status === 'UNPAID') {
        // Calculate amount paid from completed payments, or 0
        const payRes = await query(
          `SELECT COALESCE(SUM(amount), 0) as paid_sum FROM payments WHERE invoice_id = $1 AND status = 'COMPLETED'`,
          [invoiceId]
        );
        const amountPaid = parseFloat(payRes.rows[0]?.paid_sum || 0);
        const totalAmount = parseFloat(invoice.total_amount);
        const balanceDue = Math.max(0, totalAmount - amountPaid);
        let updateSql = `UPDATE invoices SET status = $1, amount_paid = $2, balance_due = $3, updated_at = NOW() WHERE id = $4`;
        const updateParams: any[] = ['UNPAID', amountPaid, balanceDue, invoiceId];
        if (tenantId && !isSuper) {
          updateSql += ` AND tenant_id = $5`;
          updateParams.push(tenantId);
        }
        await query(updateSql, updateParams);
      } else {
        let updateSql = `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2`;
        const updateParams: any[] = [status, invoiceId];
        if (tenantId && !isSuper) {
          updateSql += ` AND tenant_id = $3`;
          updateParams.push(tenantId);
        }
        await query(updateSql, updateParams);
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'INVOICE',
        entityId: invoiceId,
        description: `Updated invoice ${invoice.invoice_number} status to ${status}`,
        metadata: { status, previousStatus: invoice.status },
      });

      req.flash('success', `Invoice status updated to ${status}.`);
      res.redirect(`/invoices/${invoiceId}`);
    } catch (error) {
      invoiceLogger.error('Failed to update invoice status', { error: String(error) });
      next(error);
    }
  };

  /**
   * Record manual payment with proof document upload and note/transaction code
   */
  recordManualPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      if ((req as any).isSubscriptionCancelled) {
        req.flash('error', 'Your subscription is cancelled. Recording transactions is disabled until your subscription is renewed.');
        res.redirect(`/invoices/${invoiceId}`);
        return;
      }

      let findSql = `SELECT * FROM invoices WHERE id = $1`;
      const findParams: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        findSql += ` AND tenant_id = $2`;
        findParams.push(tenantId);
      }
      const invRes = await query(findSql, findParams);
      const invoice = invRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      const paymentAmount = parseFloat(req.body.amount || invoice.balance_due);
      if (isNaN(paymentAmount) || paymentAmount <= 0) {
        req.flash('error', 'Please enter a valid payment amount greater than zero.');
        res.redirect(`/invoices/${invoiceId}`);
        return;
      }

      const paymentMethod = req.body.paymentMethod || 'MANUAL';
      const referenceNumber = req.body.referenceNumber || req.body.transactionCode || null;
      const notes = req.body.notes || null;
      const paymentDate = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();

      let proofUrl: string | null = null;
      let proofFilename: string | null = null;

      if (req.file && tenantId) {
        try {
          const uploadRes = await storageService.uploadTenantFile(tenantId, req.file, 'payment-proofs');
          proofUrl = uploadRes.url;
          proofFilename = req.file.originalname;
        } catch (uploadErr) {
          invoiceLogger.warn('Failed to upload proof document, continuing with payment recording', { error: String(uploadErr) });
        }
      }

      const receiptNumber = `REC-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

      // Insert payment record
      await query(`
        INSERT INTO payments (
          id, tenant_id, invoice_id, amount, payment_method, status,
          payment_date, receipt_number, reference_number, proof_url,
          proof_filename, recorded_by_user_id, notes, updated_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, 'COMPLETED',
          $5, $6, $7, $8, $9, $10, $11, NOW()
        )
      `, [
        invoice.tenant_id,
        invoiceId,
        paymentAmount,
        paymentMethod,
        paymentDate,
        receiptNumber,
        referenceNumber,
        proofUrl,
        proofFilename,
        req.user?.id || null,
        notes,
      ]);

      // Calculate new totals
      const currentPaid = parseFloat(invoice.amount_paid || 0);
      const totalAmount = parseFloat(invoice.total_amount);
      const newPaid = currentPaid + paymentAmount;
      const newBalance = Math.max(0, totalAmount - newPaid);
      const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

      await query(`
        UPDATE invoices
        SET amount_paid = $1, balance_due = $2, status = $3, updated_at = NOW()
        WHERE id = $4
      `, [newPaid, newBalance, newStatus, invoiceId]);

      await ActionLogService.record(req, {
        action: AuditAction.PAYMENT,
        entityType: 'PAYMENT',
        entityId: invoiceId,
        description: `Recorded manual payment of KES ${paymentAmount.toLocaleString()} for invoice ${invoice.invoice_number}`,
        metadata: {
          paymentAmount,
          receiptNumber,
          referenceNumber,
          paymentMethod,
          proofUrl,
          newStatus,
          notes,
        },
      });

      req.flash('success', `Payment of KES ${paymentAmount.toLocaleString()} recorded successfully (Receipt: ${receiptNumber}).`);
      res.redirect(`/invoices/${invoiceId}`);
    } catch (error) {
      invoiceLogger.error('Failed to record manual payment', { error: String(error) });
      next(error);
    }
  };

  /**
   * Render edit form for invoice
   * If invoice was generated from a quotation, informs user that editing requires editing the quotation first
   */
  showEdit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let sql = `SELECT * FROM invoices WHERE id = $1`;
      const params: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        sql += ` AND tenant_id = $2`;
        params.push(tenantId);
      }
      const invRes = await query(sql, params);
      const invoice = invRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      // Check if this invoice originated from a quotation
      let sourceQuotation: any = null;
      if (invoice.quotation_id) {
        const qRes = await query(`SELECT * FROM quotations WHERE id = $1`, [invoice.quotation_id]);
        sourceQuotation = qRes.rows[0] || null;
      }

      const itemsRes = await query(
        `SELECT * FROM invoice_items WHERE invoice_id = $1 ORDER BY sort_order ASC`,
        [invoiceId]
      );

      const clientsRes = await query(
        `SELECT id, name, kra_pin FROM clients WHERE tenant_id = $1 ORDER BY name ASC`,
        [invoice.tenant_id]
      );

      const projectsRes = await query(
        `SELECT id, name, code FROM projects WHERE tenant_id = $1 ORDER BY name ASC`,
        [invoice.tenant_id]
      );

      res.render('pages/invoices/edit', {
        title: `Edit Invoice ${invoice.invoice_number}`,
        invoice,
        items: itemsRes.rows,
        clients: clientsRes.rows,
        projects: projectsRes.rows,
        sourceQuotation,
        formatKES,
      });
    } catch (error) {
      invoiceLogger.error('Failed to show edit invoice form', { error: String(error) });
      next(error);
    }
  };

  /**
   * Update standalone invoice
   * If invoice was generated from a quotation, directs user to edit quotation first
   */
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let sql = `SELECT * FROM invoices WHERE id = $1`;
      const params: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        sql += ` AND tenant_id = $2`;
        params.push(tenantId);
      }
      const invRes = await query(sql, params);
      const invoice = invRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      // If originated from a quotation, editing must be done on the quotation first
      if (invoice.quotation_id) {
        const qRes = await query(`SELECT * FROM quotations WHERE id = $1`, [invoice.quotation_id]);
        const sourceQuotation = qRes.rows[0];
        req.flash('info', `This invoice was generated from Quotation ${sourceQuotation?.quotation_number || invoice.quotation_id}. Please edit the source quotation, which will automatically update this invoice.`);
        res.redirect(`/quotations/${invoice.quotation_id}/edit`);
        return;
      }

      const { clientId, projectId, title, dueDate, terms, notes, includeVat } = req.body;
      const applyVat = includeVat === 'true' || includeVat === true || includeVat === 'on';

      // Parse items
      const descriptions = Array.isArray(req.body.itemDescriptions)
        ? req.body.itemDescriptions
        : (req.body.itemDescriptions ? [req.body.itemDescriptions] : (req.body.itemDescription ? [req.body.itemDescription] : []));
      const quantities = Array.isArray(req.body.itemQuantities)
        ? req.body.itemQuantities
        : (req.body.itemQuantities ? [req.body.itemQuantities] : (req.body.itemQty ? [req.body.itemQty] : []));
      const unitPrices = Array.isArray(req.body.itemUnitPrices)
        ? req.body.itemUnitPrices
        : (req.body.itemUnitPrices ? [req.body.itemUnitPrices] : (req.body.itemPrice ? [req.body.itemPrice] : []));

      const rawItems = descriptions.map((desc: string, i: number) => {
        const qty = parseFloat(quantities[i]) || 1;
        const price = parseFloat(unitPrices[i]) || 0;
        return {
          description: desc,
          quantity: qty,
          unitPrice: price,
          taxType: applyVat ? 'VAT_16' : 'EXEMPT',
          taxRate: applyVat ? 16 : 0,
        };
      });

      if (rawItems.length === 0) {
        req.flash('error', 'At least one line item is required.');
        res.redirect(`/invoices/${invoiceId}/edit`);
        return;
      }

      const totals = calculateInvoiceTotals(rawItems);
      const taxAmount = applyVat ? totals.totalTax : 0;
      const grandTotal = applyVat ? totals.grandTotal : totals.subtotal;
      const amountPaid = parseFloat(invoice.amount_paid || 0);
      const balanceDue = Math.max(0, grandTotal - amountPaid);
      const status = balanceDue <= 0 && amountPaid > 0 ? 'PAID' : (amountPaid > 0 ? 'PARTIALLY_PAID' : (invoice.status === 'PAID' ? 'PAID' : 'UNPAID'));

      // Update invoice record
      await query(`
        UPDATE invoices
        SET client_id = $1, project_id = $2, title = $3, due_date = $4,
            subtotal = $5, tax_amount = $6, total_amount = $7, balance_due = $8,
            status = $9, include_vat = $10, terms = $11, notes = $12, updated_at = NOW()
        WHERE id = $13
      `, [
        clientId || invoice.client_id,
        projectId || null,
        title || invoice.title,
        dueDate ? new Date(dueDate) : invoice.due_date,
        totals.subtotal,
        taxAmount,
        grandTotal,
        balanceDue,
        status,
        applyVat,
        terms !== undefined ? terms : invoice.terms,
        notes !== undefined ? notes : invoice.notes,
        invoiceId,
      ]);

      // Replace invoice items
      await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
      for (let idx = 0; idx < rawItems.length; idx++) {
        const it = rawItems[idx];
        const lineTax = it.quantity * it.unitPrice * (it.taxRate / 100);
        const lineTotal = it.quantity * it.unitPrice + lineTax;
        await query(`
          INSERT INTO invoice_items (
            id, invoice_id, description, quantity, unit_price,
            discount_percent, tax_type, tax_rate, line_total, line_tax, sort_order
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4, 0, $5, $6, $7, $8, $9
          )
        `, [
          invoiceId, it.description, it.quantity, it.unitPrice,
          it.taxType, it.taxRate, lineTotal, lineTax, idx + 1
        ]);
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'INVOICE',
        entityId: invoiceId,
        description: `Updated invoice ${invoice.invoice_number} (New Total: KES ${grandTotal})`,
        metadata: { invoiceId, totalAmount: grandTotal, subtotal: totals.subtotal, taxAmount, balanceDue },
      });

      req.flash('success', `Invoice ${invoice.invoice_number} updated successfully.`);
      res.redirect(`/invoices/${invoiceId}`);
    } catch (error) {
      invoiceLogger.error('Failed to update invoice', { error: String(error) });
      next(error);
    }
  };

  /**
   * Delete invoice
   * Reverts source quotation status so quotation can now be edited or deleted
   */
  deleteInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const invoiceId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let sql = `SELECT * FROM invoices WHERE id = $1`;
      const params: any[] = [invoiceId];
      if (tenantId && !isSuper) {
        sql += ` AND tenant_id = $2`;
        params.push(tenantId);
      }
      const invRes = await query(sql, params);
      const invoice = invRes.rows[0];
      if (!invoice) {
        req.flash('error', 'Invoice not found.');
        res.redirect('/invoices');
        return;
      }

      // Record audit log BEFORE deletion
      await ActionLogService.record(req, {
        action: AuditAction.DELETE,
        entityType: 'INVOICE',
        entityId: invoiceId,
        description: `Deleted invoice ${invoice.invoice_number} (Total: KES ${invoice.total_amount})`,
        metadata: {
          invoiceId,
          invoiceNumber: invoice.invoice_number,
          totalAmount: invoice.total_amount,
          amountPaid: invoice.amount_paid,
          balanceDue: invoice.balance_due,
          quotationId: invoice.quotation_id,
          clientId: invoice.client_id,
        },
      });

      // If linked to a quotation, revert the quotation's status to 'APPROVED' and unlink invoice
      if (invoice.quotation_id) {
        await query(`
          UPDATE quotations
          SET converted_invoice_id = NULL, status = 'APPROVED', updated_at = NOW()
          WHERE id = $1
        `, [invoice.quotation_id]);

        await ActionLogService.record(req, {
          action: AuditAction.UPDATE,
          entityType: 'QUOTATION',
          entityId: invoice.quotation_id,
          description: `Reverted quotation status to APPROVED after deletion of Invoice ${invoice.invoice_number}`,
          metadata: { quotationId: invoice.quotation_id, deletedInvoiceId: invoiceId },
        });
      }

      // Delete payments, items, and invoice
      await query(`DELETE FROM payments WHERE invoice_id = $1`, [invoiceId]);
      await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]);
      await query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);

      req.flash('success', `Invoice ${invoice.invoice_number} deleted successfully. ${invoice.quotation_id ? 'Source quotation status reverted.' : ''}`);
      res.redirect('/invoices');
    } catch (error) {
      invoiceLogger.error('Failed to delete invoice', { error: String(error) });
      next(error);
    }
  };
}

export default new InvoiceController();
