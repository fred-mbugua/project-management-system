// ══════════════════════════════════════════════════════════════════════
// Accounting Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const accLogger = logger.child('AccountingController');

export class AccountingController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const params = extractPaginationParams(req, 10);
      const payConditions: string[] = [];
      const payValues: any[] = [];
      let payIdx = 1;

      if (tenantId && !isSuper) {
        payConditions.push(`p.tenant_id = $${payIdx++}`);
        payValues.push(tenantId);
      }

      if (params.search) {
        payConditions.push(`(
          p.mpesa_receipt_number ILIKE $${payIdx} OR
          p.bank_reference ILIKE $${payIdx} OR
          i.invoice_number ILIKE $${payIdx} OR
          c.name ILIKE $${payIdx}
        )`);
        payValues.push(`%${params.search}%`);
        payIdx++;
      }

      if (params.startDate) {
        payConditions.push(`p.payment_date >= $${payIdx++}::timestamptz`);
        payValues.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        payConditions.push(`p.payment_date <= $${payIdx++}::timestamptz`);
        payValues.push(`${params.endDate}T23:59:59Z`);
      }

      const payWhereClause = payConditions.length > 0 ? `WHERE ${payConditions.join(' AND ')}` : '';

      const countSql = `
        SELECT COUNT(*)::int as total
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        LEFT JOIN clients c ON i.client_id = c.id
        ${payWhereClause}
      `;
      const countRes = await query(countSql, payValues);
      const totalPayments = countRes.rows[0]?.total || 0;

      const dataSql = `
        SELECT p.*, i.invoice_number, c.name as client_name
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        LEFT JOIN clients c ON i.client_id = c.id
        ${payWhereClause}
        ORDER BY p.payment_date DESC, p.created_at DESC
        LIMIT $${payIdx++} OFFSET $${payIdx++}
      `;
      const dataValues = [...payValues, params.limit, params.offset];

      // Invoices period filter
      const invConditions: string[] = ["status != 'CANCELLED'"];
      const invValues: any[] = [];
      let invIdx = 1;
      if (tenantId && !isSuper) {
        invConditions.push(`tenant_id = $${invIdx++}`);
        invValues.push(tenantId);
      }
      if (params.startDate) {
        invConditions.push(`created_at >= $${invIdx++}::timestamptz`);
        invValues.push(`${params.startDate}T00:00:00Z`);
      }
      if (params.endDate) {
        invConditions.push(`created_at <= $${invIdx++}::timestamptz`);
        invValues.push(`${params.endDate}T23:59:59Z`);
      }
      const invWhere = `WHERE ${invConditions.join(' AND ')}`;

      // Payments period filter
      const paySumConditions: string[] = ["status = 'COMPLETED'"];
      const paySumValues: any[] = [];
      let paySumIdx = 1;
      if (tenantId && !isSuper) {
        paySumConditions.push(`tenant_id = $${paySumIdx++}`);
        paySumValues.push(tenantId);
      }
      if (params.startDate) {
        paySumConditions.push(`payment_date >= $${paySumIdx++}::timestamptz`);
        paySumValues.push(`${params.startDate}T00:00:00Z`);
      }
      if (params.endDate) {
        paySumConditions.push(`payment_date <= $${paySumIdx++}::timestamptz`);
        paySumValues.push(`${params.endDate}T23:59:59Z`);
      }
      const paySumWhere = `WHERE ${paySumConditions.join(' AND ')}`;

      // Expenses period filter
      const expConditions: string[] = [];
      const expValues: any[] = [];
      let expIdx = 1;
      if (tenantId && !isSuper) {
        expConditions.push(`tenant_id = $${expIdx++}`);
        expValues.push(tenantId);
      }
      if (params.startDate) {
        expConditions.push(`created_at >= $${expIdx++}::timestamptz`);
        expValues.push(`${params.startDate}T00:00:00Z`);
      }
      if (params.endDate) {
        expConditions.push(`created_at <= $${expIdx++}::timestamptz`);
        expValues.push(`${params.endDate}T23:59:59Z`);
      }
      const expWhere = expConditions.length > 0 ? `WHERE ${expConditions.join(' AND ')}` : '';

      const [invoicesSummary, paymentsSummary, expensesSummary, methodBreakdown, recentPayments] = await Promise.all([
        query(`
          SELECT 
            COALESCE(SUM(total_amount), 0)::numeric as total_invoiced,
            COALESCE(SUM(tax_amount), 0)::numeric as total_output_vat,
            COALESCE(SUM(balance_due), 0)::numeric as total_receivables,
            COUNT(*)::int as invoice_count
          FROM invoices
          ${invWhere}
        `, invValues),
        query(`
          SELECT 
            COALESCE(SUM(amount), 0)::numeric as total_collected,
            COUNT(*)::int as payment_count
          FROM payments
          ${paySumWhere}
        `, paySumValues),
        query(`
          SELECT 
            COALESCE(SUM(amount), 0)::numeric as total_expenses,
            COALESCE(SUM(vat_amount), 0)::numeric as total_input_vat,
            COUNT(*)::int as expense_count
          FROM expenses
          ${expWhere}
        `, expValues),
        query(`
          SELECT 
            payment_method,
            COUNT(*)::int as count,
            COALESCE(SUM(amount), 0)::numeric as total
          FROM payments
          ${paySumWhere}
          GROUP BY payment_method
          ORDER BY total DESC
        `, paySumValues),
        query(dataSql, dataValues),
      ]);

      const inv = invoicesSummary.rows[0];
      const pay = paymentsSummary.rows[0];
      const exp = expensesSummary.rows[0];

      const totalInvoiced = parseFloat(inv.total_invoiced || 0);
      const totalCollected = parseFloat(pay.total_collected || 0);
      const totalReceivables = parseFloat(inv.total_receivables || 0);
      const totalExpenses = parseFloat(exp.total_expenses || 0);
      const outputVat = parseFloat(inv.total_output_vat || 0);
      const inputVat = parseFloat(exp.total_input_vat || 0);
      const netVatPayable = outputVat - inputVat;
      const netOperatingProfit = totalCollected - totalExpenses;

      const pagination = calculatePagination(totalPayments, params, req);

      res.render('pages/accounting/index', {
        title: 'Accounting & Tax Reports',
        metrics: {
          totalInvoiced,
          totalCollected,
          totalReceivables,
          totalExpenses,
          outputVat,
          inputVat,
          netVatPayable,
          netOperatingProfit,
          invoiceCount: inv.invoice_count,
          paymentCount: pay.payment_count,
          expenseCount: exp.expense_count,
        },
        methodBreakdown: methodBreakdown.rows,
        recentPayments: recentPayments.rows,
        pagination,
        filters: params,
        formatKES,
      });
    } catch (error) {
      accLogger.error('Failed to load accounting overview', { error: String(error) });
      next(error);
    }
  };
}

export default new AccountingController();
