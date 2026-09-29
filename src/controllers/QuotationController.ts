// ══════════════════════════════════════════════════════════════════════
// Quotation Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { QuotationModel, QuotationStatus } from '../models';
import { calculateInvoiceTotals, formatKES } from '../utils/taxCalculator';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
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

      const [clientsRes, projectsRes] = await Promise.all([
        tenantId
          ? query(`SELECT id, name FROM clients WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name ASC`, [tenantId])
          : query(`SELECT id, name FROM clients WHERE is_active = TRUE ORDER BY name ASC`),
        tenantId
          ? query(`SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' ORDER BY name ASC`, [tenantId])
          : query(`SELECT id, name, code FROM projects WHERE status != 'CANCELLED' ORDER BY name ASC`),
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
}

export default new QuotationController();

