// ══════════════════════════════════════════════════════════════════════
// Quotation Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { QuotationModel, QuotationStatus } from '../models';
import { calculateInvoiceTotals, formatKES } from '../utils/taxCalculator';
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

      let sql: string;
      let params: any[];
      if (tenantId) {
        sql = `
          SELECT 
            q.*,
            c.name as client_name,
            p.name as project_name
          FROM quotations q
          LEFT JOIN clients c ON q.client_id = c.id
          LEFT JOIN projects p ON q.project_id = p.id
          WHERE q.tenant_id = $1
          ORDER BY q.created_at DESC
        `;
        params = [tenantId];
      } else {
        sql = `
          SELECT 
            q.*,
            c.name as client_name,
            p.name as project_name
          FROM quotations q
          LEFT JOIN clients c ON q.client_id = c.id
          LEFT JOIN projects p ON q.project_id = p.id
          ORDER BY q.created_at DESC
        `;
        params = [];
      }
      const result = await query(sql, params);

      res.render('pages/quotations/index', {
        title: 'Quotations',
        quotations: result.rows,
        formatKES,
      });
    } catch (error) {
      quoteLogger.error('Failed to list quotations', { error: String(error) });
      next(error);
    }
  };

  showNew = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
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
}

export default new QuotationController();

