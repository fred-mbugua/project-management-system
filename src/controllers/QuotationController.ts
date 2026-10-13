// ══════════════════════════════════════════════════════════════════════
// Quotation Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { QuotationModel, QuotationStatus, AuditAction } from '../models';
import { calculateInvoiceTotals, formatKES } from '../utils/taxCalculator';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { isAssignedProjectsOnly } from '../middleware/rbac';
import ActionLogService from '../services/actionLog.service';
import pdfService from '../services/pdf.service';
import logger from '../utils/logger';

const quoteLogger = logger.child('QuotationController');

export class QuotationController {
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
        conditions.push(`q.tenant_id = $${paramIdx++}`);
        values.push(tenantId);
      }

      // Restrict to quotations linked to assigned projects if user is scoped
      if (req.user && isAssignedProjectsOnly(req.user)) {
        conditions.push(`(
          q.project_id IS NOT NULL AND (
            EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = q.project_id AND pm.user_id = $${paramIdx})
            OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = q.project_id AND t.assigned_to_id = $${paramIdx})
          )
        )`);
        values.push(req.user.id);
        paramIdx++;
      }

      if (params.search) {
        conditions.push(`(
          q.quotation_number ILIKE $${paramIdx} OR 
          c.name ILIKE $${paramIdx} OR 
          q.title ILIKE $${paramIdx} OR
          p.name ILIKE $${paramIdx} OR
          q.notes ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`q.created_at >= $${paramIdx++}::timestamptz`);
        values.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        conditions.push(`q.created_at <= $${paramIdx++}::timestamptz`);
        values.push(`${params.endDate}T23:59:59Z`);
      }

      if (params.status) {
        conditions.push(`q.status = $${paramIdx++}`);
        values.push(params.status);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Total count for pagination
      const countSql = `
        SELECT COUNT(*)::int as total
        FROM quotations q
        LEFT JOIN clients c ON q.client_id = c.id
        LEFT JOIN projects p ON q.project_id = p.id
        ${whereClause}
      `;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

      // Newest always at top: ORDER BY q.created_at DESC
      const dataSql = `
        SELECT 
          q.*,
          c.name as client_name,
          p.name as project_name,
          p.code as project_code
        FROM quotations q
        LEFT JOIN clients c ON q.client_id = c.id
        LEFT JOIN projects p ON q.project_id = p.id
        ${whereClause}
        ORDER BY q.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];
      const result = await query(dataSql, dataValues);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/quotations/index', {
        title: 'Quotations',
        quotations: result.rows,
        pagination,
        filters: params,
        formatKES,
      });
    } catch (error) {
      quoteLogger.error('Failed to list quotations', { error: String(error) });
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

      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

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

      const [clientsRes, projectsRes] = await Promise.all([
        tenantId
          ? query(`SELECT id, name FROM clients WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name ASC`, [tenantId])
          : query(`SELECT id, name FROM clients WHERE is_active = TRUE ORDER BY name ASC`),
        projectsQuery,
      ]);

      const countRes = tenantId
        ? await query(`SELECT COUNT(*)::int as count FROM quotations WHERE tenant_id = $1`, [tenantId])
        : await query(`SELECT COUNT(*)::int as count FROM quotations`);
      const nextNum = (countRes.rows[0]?.count || 0) + 1;
      const quotationNumber = `QUO-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;

      res.render('pages/quotations/new', {
        title: 'New Quotation',
        clients: clientsRes.rows,
        projects: projectsRes.rows,
        quotationNumber,
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

      const { clientId, projectId, quotationNumber, title, validUntil, notes, terms, itemDescription, itemQty, itemPrice } = req.body;

      if (!clientId || !quotationNumber || !validUntil) {
        req.flash('error', 'Client, Quotation Number, and Validity Date are required.');
        res.redirect('/quotations/new');
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
          req.flash('error', 'You can only create quotations for projects assigned to you.');
          res.redirect('/quotations/new');
          return;
        }
      }

      const qty = parseFloat(itemQty) || 1;
      const price = parseFloat(itemPrice) || 0;
      const totals = calculateInvoiceTotals([{
        description: itemDescription || 'General Services',
        quantity: qty,
        unitPrice: price,
        discountPercent: 0,
        taxType: 'VAT_16' as any,
      }]);

      await QuotationModel.create({
        tenantId,
        clientId,
        projectId: projectId || null,
        quotationNumber,
        title: title || 'Service Quotation',
        status: QuotationStatus.SENT,
        validUntil: new Date(validUntil),
        subtotal: totals.subtotal,
        taxAmount: totals.totalTax,
        totalAmount: totals.grandTotal,
        notes: notes || null,
        terms: terms || 'Valid for 30 days from date of issue.',
        items: [{
          description: itemDescription || 'General Services',
          quantity: qty,
          unitPrice: price,
          lineTotal: totals.grandTotal,
          lineTax: totals.totalTax,
        }],
      });

      req.flash('success', `Quotation ${quotationNumber} generated successfully.`);
      res.redirect('/quotations');
    } catch (error) {
      quoteLogger.error('Failed to create quotation', { error: String(error) });
      next(error);
    }
  };

  show = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      const quoteId = req.params.id as string;

      let sql = `
        SELECT 
          q.*,
          c.name as client_name,
          c.email as client_email,
          c.phone as client_phone,
          c.address as client_address,
          c.city as client_city,
          c.kra_pin as client_kra_pin,
          p.name as project_name,
          p.code as project_code,
          t.name as tenant_name,
          t.email as tenant_email,
          t.phone as tenant_phone,
          t.address as tenant_address,
          t.city as tenant_city,
          t.kra_pin as tenant_kra_pin,
          t.logo_url as tenant_logo_url,
          t.primary_color as tenant_primary_color
        FROM quotations q
        LEFT JOIN clients c ON q.client_id = c.id
        LEFT JOIN projects p ON q.project_id = p.id
        LEFT JOIN tenants t ON q.tenant_id = t.id
        WHERE q.id = $1
      `;
      const params: any[] = [quoteId];
      if (tenantId && !isSuper) {
        sql += ` AND q.tenant_id = $2`;
        params.push(tenantId);
      }
      sql += ` LIMIT 1`;

      const [quoteRes, itemsRes] = await Promise.all([
        query(sql, params),
        query(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order ASC, id ASC`, [quoteId]),
      ]);

      const quotation = quoteRes.rows[0];
      if (!quotation) {
        req.flash('error', 'Quotation not found.');
        res.redirect('/quotations');
        return;
      }

      // If user is restricted to assigned projects only, verify access
      if (req.user && isAssignedProjectsOnly(req.user)) {
        if (!quotation.project_id) {
          req.flash('error', 'You do not have permission to view this quotation.');
          res.redirect('/quotations');
          return;
        }
        const memberCheck = await query(`
          SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
          UNION
          SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2
          LIMIT 1
        `, [quotation.project_id, req.user.id]);
        if (memberCheck.rows.length === 0) {
          req.flash('error', 'You do not have permission to view this quotation.');
          res.redirect('/quotations');
          return;
        }
      }

      res.render('pages/quotations/show', {
        title: `Quotation ${quotation.quotation_number}`,
        quotation,
        items: itemsRes.rows,
        formatKES,
      });
    } catch (error) {
      quoteLogger.error('Failed to show quotation', { error: String(error) });
      next(error);
    }
  };

  convertToInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if ((req as any).isSubscriptionCancelled) {
        req.flash('error', 'Your subscription is cancelled. Creating new transactions is disabled until your subscription is renewed.');
        res.redirect('/subscription/pay');
        return;
      }

      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      const quoteId = req.params.id as string;

      let sql = `SELECT * FROM quotations WHERE id = $1`;
      const params: any[] = [quoteId];
      if (tenantId && !isSuper) {
        sql += ` AND tenant_id = $2`;
        params.push(tenantId);
      }
      const quoteRes = await query(sql, params);
      const quotation = quoteRes.rows[0];
      if (!quotation) {
        req.flash('error', 'Quotation not found.');
        res.redirect('/quotations');
        return;
      }

      if (quotation.converted_invoice_id) {
        req.flash('info', 'This quotation has already been converted to an invoice.');
        res.redirect(`/invoices/${quotation.converted_invoice_id}`);
        return;
      }

      const itemsRes = await query(
        `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order ASC`,
        [quoteId]
      );

      const countRes = await query(
        `SELECT COUNT(*)::int as count FROM invoices WHERE tenant_id = $1`,
        [quotation.tenant_id]
      );
      const nextNum = (countRes.rows[0]?.count || 0) + 1;
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;

      const invRes = await query(`
        INSERT INTO invoices (
          id, tenant_id, client_id, project_id, quotation_id,
          invoice_number, title, status, issue_date, due_date,
          subtotal, tax_amount, discount_amount, total_amount,
          amount_paid, balance_due, notes, terms, updated_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4,
          $5, $6, 'SENT', NOW(), NOW() + INTERVAL '30 days',
          $7, $8, $9, $10,
          0, $10, $11, $12, NOW()
        ) RETURNING id
      `, [
        quotation.tenant_id,
        quotation.client_id,
        quotation.project_id,
        quotation.id,
        invoiceNumber,
        quotation.title || 'Professional Services',
        quotation.subtotal,
        quotation.tax_amount,
        quotation.discount_amount || 0,
        quotation.total_amount,
        quotation.notes,
        quotation.terms,
      ]);

      const newInvoiceId = invRes.rows[0].id;

      for (const item of itemsRes.rows) {
        await query(`
          INSERT INTO invoice_items (
            id, invoice_id, description, quantity, unit_price,
            discount_percent, tax_type, tax_rate, line_total, line_tax, sort_order
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4,
            $5, $6, $7, $8, $9, $10
          )
        `, [
          newInvoiceId,
          item.description,
          item.quantity,
          item.unit_price,
          item.discount_percent || 0,
          item.tax_type || 'VAT_16',
          item.tax_rate || 16,
          item.line_total,
          item.line_tax || 0,
          item.sort_order || 0,
        ]);
      }

      await query(`
        UPDATE quotations 
        SET status = 'CONVERTED', converted_invoice_id = $1, updated_at = NOW() 
        WHERE id = $2
      `, [newInvoiceId, quoteId]);

      req.flash('success', `Quotation successfully converted to Invoice ${invoiceNumber}!`);
      res.redirect(`/invoices/${newInvoiceId}`);
    } catch (error) {
      quoteLogger.error('Failed to convert quotation to invoice', { error: String(error) });
      next(error);
    }
  };

  downloadPdf = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const quoteId = req.params.id as string;
      if ((req as any).isSubscriptionCancelled) {
        req.flash('error', 'Your subscription is cancelled. Downloading and printing quotations is disabled until your subscription is renewed.');
        res.redirect(`/quotations/${quoteId}`);
        return;
      }

      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;

      let sql = `
        SELECT 
          q.*,
          c.name as client_name,
          c.email as client_email,
          c.phone as client_phone,
          c.address as client_address,
          c.city as client_city,
          c.kra_pin as client_kra_pin,
          p.name as project_name,
          p.code as project_code,
          t.name as tenant_name,
          t.email as tenant_email,
          t.phone as tenant_phone,
          t.address as tenant_address,
          t.city as tenant_city,
          t.kra_pin as tenant_kra_pin,
          t.logo_url as tenant_logo_url,
          t.primary_color as tenant_primary_color,
          t.secondary_color as tenant_secondary_color,
          t.accent_color as tenant_accent_color,
          t.bank_details as tenant_bank_details,
          t.invoice_template as tenant_invoice_template,
          t.display_fields as tenant_display_fields,
          t.daraja_shortcode as tenant_daraja_shortcode,
          t.daraja_shortcode_type as tenant_daraja_shortcode_type
        FROM quotations q
        LEFT JOIN clients c ON q.client_id = c.id
        LEFT JOIN projects p ON q.project_id = p.id
        LEFT JOIN tenants t ON q.tenant_id = t.id
        WHERE q.id = $1
      `;
      const params: any[] = [quoteId];
      if (tenantId && !isSuper) {
        sql += ` AND q.tenant_id = $2`;
        params.push(tenantId);
      }
      sql += ` LIMIT 1`;

      const [quoteRes, itemsRes] = await Promise.all([
        query(sql, params),
        query(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order ASC, id ASC`, [quoteId]),
      ]);

      const quote = quoteRes.rows[0];
      if (!quote) {
        res.status(404).send('Quotation not found');
        return;
      }

      // If user is restricted to assigned projects only, verify access
      if (req.user && isAssignedProjectsOnly(req.user)) {
        if (!quote.project_id) {
          res.status(403).send('You do not have permission to download this quotation.');
          return;
        }
        const memberCheck = await query(`
          SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
          UNION
          SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2
          LIMIT 1
        `, [quote.project_id, req.user.id]);
        if (memberCheck.rows.length === 0) {
          res.status(403).send('You do not have permission to download this quotation.');
          return;
        }
      }

      const selectedTemplate = (req.query.template as string) || quote.template || quote.tenant_invoice_template || 'modern';
      const customColor = (req.query.color as string) || quote.custom_color || quote.tenant_primary_color || '#4F46E5';

      let displayFields: any = {};
      if (quote.tenant_display_fields) {
        try {
          displayFields = typeof quote.tenant_display_fields === 'string'
            ? JSON.parse(quote.tenant_display_fields)
            : quote.tenant_display_fields;
        } catch {}
      }

      await pdfService.generateDocumentPdf({
        type: 'quotation',
        documentNumber: quote.quotation_number,
        title: quote.title,
        status: quote.status,
        issueDate: quote.created_at,
        dueDateOrValidUntil: quote.valid_until,
        dueDateLabel: 'Valid Until',
        notes: quote.notes,
        terms: quote.terms,
        template: selectedTemplate,
        customColor,
        displayFields,
        subtotal: quote.subtotal,
        taxAmount: quote.tax_amount,
        discountAmount: quote.discount_amount,
        totalAmount: quote.total_amount,
        tenant: {
          name: quote.tenant_name || 'Organization',
          email: quote.tenant_email,
          phone: quote.tenant_phone,
          address: quote.tenant_address,
          city: quote.tenant_city,
          kraPin: quote.tenant_kra_pin,
          logoUrl: quote.tenant_logo_url,
          primaryColor: quote.tenant_primary_color,
          secondaryColor: quote.tenant_secondary_color,
          accentColor: quote.tenant_accent_color,
          bankDetails: quote.tenant_bank_details,
          darajaShortcode: quote.tenant_daraja_shortcode,
          darajaShortcodeType: quote.tenant_daraja_shortcode_type,
        },
        client: {
          name: quote.client_name || 'Client',
          email: quote.client_email,
          phone: quote.client_phone,
          address: quote.client_address,
          city: quote.client_city,
          kraPin: quote.client_kra_pin,
        },
        project: quote.project_name ? { name: quote.project_name, code: quote.project_code } : null,
        items: itemsRes.rows.map((it: any) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          lineTax: it.line_tax,
          lineTotal: it.line_total,
        })),
      }, res);
    } catch (error) {
      quoteLogger.error('Failed to generate quotation PDF', { error: String(error) });
      next(error);
    }
  };

  /**
   * Render edit form for quotation
   */
  showEdit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const quoteId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let sql = `SELECT * FROM quotations WHERE id = $1`;
      const params: any[] = [quoteId];
      if (tenantId && !isSuper) {
        sql += ` AND tenant_id = $2`;
        params.push(tenantId);
      }
      const quoteRes = await query(sql, params);
      const quotation = quoteRes.rows[0];
      if (!quotation) {
        req.flash('error', 'Quotation not found.');
        res.redirect('/quotations');
        return;
      }

      // Check if quotation has progressed to an active invoice
      const invRes = await query(
        `SELECT id, invoice_number, total_amount, status FROM invoices WHERE quotation_id = $1 OR id = $2 LIMIT 1`,
        [quoteId, quotation.converted_invoice_id || '']
      );
      const linkedInvoice = invRes.rows[0] || null;

      const itemsRes = await query(
        `SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY sort_order ASC`,
        [quoteId]
      );

      const clientsRes = await query(
        `SELECT id, name, kra_pin FROM clients WHERE tenant_id = $1 ORDER BY name ASC`,
        [quotation.tenant_id]
      );

      const projectsRes = await query(
        `SELECT id, name, code FROM projects WHERE tenant_id = $1 ORDER BY name ASC`,
        [quotation.tenant_id]
      );

      res.render('pages/quotations/edit', {
        title: `Edit Quotation ${quotation.quotation_number}`,
        quotation,
        items: itemsRes.rows,
        clients: clientsRes.rows,
        projects: projectsRes.rows,
        linkedInvoice,
        formatKES,
      });
    } catch (error) {
      quoteLogger.error('Failed to show edit quotation form', { error: String(error) });
      next(error);
    }
  };

  /**
   * Update quotation and synchronize with linked invoice if quotation has progressed
   */
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const quoteId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let sql = `SELECT * FROM quotations WHERE id = $1`;
      const params: any[] = [quoteId];
      if (tenantId && !isSuper) {
        sql += ` AND tenant_id = $2`;
        params.push(tenantId);
      }
      const quoteRes = await query(sql, params);
      const quotation = quoteRes.rows[0];
      if (!quotation) {
        req.flash('error', 'Quotation not found.');
        res.redirect('/quotations');
        return;
      }

      const { clientId, projectId, title, validUntil, terms, notes, includeVat } = req.body;
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
        res.redirect(`/quotations/${quoteId}/edit`);
        return;
      }

      const totals = calculateInvoiceTotals(rawItems);
      const taxAmount = applyVat ? totals.totalTax : 0;
      const grandTotal = applyVat ? totals.grandTotal : totals.subtotal;

      // Update quotation record
      await query(`
        UPDATE quotations
        SET client_id = $1, project_id = $2, title = $3, valid_until = $4,
            subtotal = $5, tax_amount = $6, total_amount = $7,
            terms = $8, notes = $9, updated_at = NOW()
        WHERE id = $10
      `, [
        clientId || quotation.client_id,
        projectId || null,
        title || quotation.title,
        validUntil ? new Date(validUntil) : quotation.valid_until,
        totals.subtotal,
        taxAmount,
        grandTotal,
        terms !== undefined ? terms : quotation.terms,
        notes !== undefined ? notes : quotation.notes,
        quoteId,
      ]);

      // Replace quotation items
      await query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [quoteId]);
      for (let idx = 0; idx < rawItems.length; idx++) {
        const it = rawItems[idx];
        const lineTax = it.quantity * it.unitPrice * (it.taxRate / 100);
        const lineTotal = it.quantity * it.unitPrice + lineTax;
        await query(`
          INSERT INTO quotation_items (
            id, quotation_id, description, quantity, unit_price,
            discount_percent, tax_type, tax_rate, line_total, line_tax, sort_order
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, $4, 0, $5, $6, $7, $8, $9
          )
        `, [
          quoteId, it.description, it.quantity, it.unitPrice,
          it.taxType, it.taxRate, lineTotal, lineTax, idx + 1
        ]);
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'QUOTATION',
        entityId: quoteId,
        description: `Updated quotation ${quotation.quotation_number} (New Total: KES ${grandTotal})`,
        metadata: { quotationId: quoteId, totalAmount: grandTotal, subtotal: totals.subtotal, taxAmount },
      });

      // CHECK IF QUOTATION HAS PROGRESSED TO AN INVOICE
      const invCheck = await query(
        `SELECT * FROM invoices WHERE quotation_id = $1 OR id = $2 LIMIT 1`,
        [quoteId, quotation.converted_invoice_id || '']
      );
      const linkedInvoice = invCheck.rows[0];

      if (linkedInvoice) {
        // Automatically synchronize the progressed invoice!
        const invPaid = parseFloat(linkedInvoice.amount_paid || 0);
        const newBalance = Math.max(0, grandTotal - invPaid);
        const newStatus = newBalance <= 0 && invPaid > 0 ? 'PAID' : (invPaid > 0 ? 'PARTIALLY_PAID' : (linkedInvoice.status === 'PAID' ? 'PAID' : 'UNPAID'));

        await query(`
          UPDATE invoices
          SET client_id = $1, project_id = $2, title = $3,
              subtotal = $4, tax_amount = $5, total_amount = $6,
              balance_due = $7, status = $8, include_vat = $9,
              terms = $10, notes = $11, updated_at = NOW()
          WHERE id = $12
        `, [
          clientId || quotation.client_id,
          projectId || null,
          title || quotation.title,
          totals.subtotal,
          taxAmount,
          grandTotal,
          newBalance,
          newStatus,
          applyVat,
          terms !== undefined ? terms : quotation.terms,
          notes !== undefined ? notes : quotation.notes,
          linkedInvoice.id,
        ]);

        // Replace invoice items with updated quotation items
        await query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [linkedInvoice.id]);
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
            linkedInvoice.id, it.description, it.quantity, it.unitPrice,
            it.taxType, it.taxRate, lineTotal, lineTax, idx + 1
          ]);
        }

        await ActionLogService.record(req, {
          action: AuditAction.UPDATE,
          entityType: 'INVOICE',
          entityId: linkedInvoice.id,
          description: `Synchronized invoice ${linkedInvoice.invoice_number} from updated Quotation ${quotation.quotation_number}`,
          metadata: { invoiceId: linkedInvoice.id, sourceQuotationId: quoteId, newTotal: grandTotal, newBalance },
        });

        req.flash('success', `Quotation ${quotation.quotation_number} updated and synchronized to Invoice ${linkedInvoice.invoice_number} successfully!`);
      } else {
        req.flash('success', `Quotation ${quotation.quotation_number} updated successfully.`);
      }

      res.redirect(`/quotations/${quoteId}`);
    } catch (error) {
      quoteLogger.error('Failed to update quotation', { error: String(error) });
      next(error);
    }
  };

  /**
   * Delete quotation - only permitted if it has NOT progressed to an invoice
   */
  deleteQuotation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const quoteId = req.params.id as string;
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      let sql = `SELECT * FROM quotations WHERE id = $1`;
      const params: any[] = [quoteId];
      if (tenantId && !isSuper) {
        sql += ` AND tenant_id = $2`;
        params.push(tenantId);
      }
      const quoteRes = await query(sql, params);
      const quotation = quoteRes.rows[0];
      if (!quotation) {
        req.flash('error', 'Quotation not found.');
        res.redirect('/quotations');
        return;
      }

      // Check if quotation has progressed to an active invoice
      const invCheck = await query(
        `SELECT id, invoice_number FROM invoices WHERE quotation_id = $1 OR id = $2 LIMIT 1`,
        [quoteId, quotation.converted_invoice_id || '']
      );
      const linkedInvoice = invCheck.rows[0];

      if (linkedInvoice) {
        req.flash('error', `Cannot delete Quotation ${quotation.quotation_number} because it has progressed to Invoice ${linkedInvoice.invoice_number}. You must delete Invoice ${linkedInvoice.invoice_number} first.`);
        res.redirect(`/quotations/${quoteId}`);
        return;
      }

      // Record audit log BEFORE deletion
      await ActionLogService.record(req, {
        action: AuditAction.DELETE,
        entityType: 'QUOTATION',
        entityId: quoteId,
        description: `Deleted quotation ${quotation.quotation_number} (Total: KES ${quotation.total_amount})`,
        metadata: {
          quotationId: quoteId,
          quotationNumber: quotation.quotation_number,
          title: quotation.title,
          clientId: quotation.client_id,
          totalAmount: quotation.total_amount,
          subtotal: quotation.subtotal,
          taxAmount: quotation.tax_amount,
        },
      });

      // Delete quotation items and quotation
      await query(`DELETE FROM quotation_items WHERE quotation_id = $1`, [quoteId]);
      await query(`DELETE FROM quotations WHERE id = $1`, [quoteId]);

      req.flash('success', `Quotation ${quotation.quotation_number} deleted successfully.`);
      res.redirect('/quotations');
    } catch (error) {
      quoteLogger.error('Failed to delete quotation', { error: String(error) });
      next(error);
    }
  };
}

export default new QuotationController();

