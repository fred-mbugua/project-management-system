// ══════════════════════════════════════════════════════════════════════
// Invoice Controller - Raw PostgreSQL Queries
// Invoicing, tax calculations, and eTIMS compliance
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { InvoiceModel, InvoiceStatus, TaxType, AuditAction } from '../models';
import { calculateInvoiceTotals, generateEtimsHash, generateEtimsQrPayload, formatKES } from '../utils/taxCalculator';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
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
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      const invoiceId = req.params.id as string;

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
   * Manually update invoice status (e.g. PAID, PARTIALLY_PAID, SENT, OVERDUE, CANCELLED)
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

      if (req.file) {
        try {
          const uploadRes = await storageService.uploadFile(req.file, 'payment-proofs');
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
}

export default new InvoiceController();
