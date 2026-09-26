// ══════════════════════════════════════════════════════════════════════
// Invoice Controller - Raw PostgreSQL Queries
// Invoicing, tax calculations, and eTIMS compliance
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { InvoiceModel, InvoiceStatus, TaxType } from '../models';
import { calculateInvoiceTotals, generateEtimsHash, generateEtimsQrPayload, formatKES } from '../utils/taxCalculator';
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

      const sql = (isSuper && !tenantId)
        ? `
          SELECT 
            i.*,
            c.name as client_name,
            p.name as project_name,
            p.code as project_code
          FROM invoices i
          LEFT JOIN clients c ON i.client_id = c.id
          LEFT JOIN projects p ON i.project_id = p.id
          ORDER BY i.issue_date DESC
        `
        : `
          SELECT 
            i.*,
            c.name as client_name,
            p.name as project_name,
            p.code as project_code
          FROM invoices i
          LEFT JOIN clients c ON i.client_id = c.id
          LEFT JOIN projects p ON i.project_id = p.id
          WHERE i.tenant_id = $1
          ORDER BY i.issue_date DESC
        `;
      const result = (isSuper && !tenantId) ? await query(sql) : await query(sql, [tenantId]);

      res.render('pages/invoices/index', {
        title: 'Invoices',
        invoices: result.rows,
        formatKES,
      });
    } catch (error) {
      invoiceLogger.error('Failed to list invoices', { error: String(error) });
      next(error);
    }
  };

  showNew = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const [clientsRes, projectsRes] = await Promise.all([
        query(`SELECT id, name, kra_pin FROM clients WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name ASC`, [tenantId]),
        query(`SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' ORDER BY name ASC`, [tenantId]),
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
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
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
      } = req.body;

      if (!clientId || !invoiceNumber || !dueDate) {
        req.flash('error', 'Client, Invoice Number, and Due Date are required.');
        res.redirect('/invoices/new');
        return;
      }

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
            taxType: TaxType.VAT_16,
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
        totalAmount: totals.grandTotal,
        taxAmount: totals.totalTax,
      };

      const etimsHash = generateEtimsHash(etimsPayloadInput);
      const etimsQr = generateEtimsQrPayload(etimsPayloadInput);

      const invoice = await InvoiceModel.create({
        tenantId,
        clientId,
        projectId: projectId || null,
        invoiceNumber,
        title: title || 'Professional Services',
        status: InvoiceStatus.SENT,
        issueDate,
        dueDate: new Date(dueDate),
        subtotal: totals.subtotal,
        taxAmount: totals.totalTax,
        discountAmount: totals.totalDiscount,
        totalAmount: totals.grandTotal,
        amountPaid: 0,
        balanceDue: totals.grandTotal,
        notes: notes || null,
        terms: terms || 'Payment due within 30 days.',
        tenantKraPin,
        clientKraPin,
        etimsVerificationHash: etimsHash,
        etimsQrPayload: etimsQr,
        items: rawItems.map((item, idx) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxType: item.taxType,
          taxRate: 16,
          lineTotal: item.quantity * item.unitPrice * 1.16,
          lineTax: item.quantity * item.unitPrice * 0.16,
          sortOrder: idx + 1,
        })),
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

}

export default new InvoiceController();
