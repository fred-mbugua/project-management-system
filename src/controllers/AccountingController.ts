// ══════════════════════════════════════════════════════════════════════
// Accounting Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
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

      const [invoicesSummary, paymentsSummary, expensesSummary, recentPayments] = await Promise.all([
        tenantId
          ? query(`
              SELECT 
                COALESCE(SUM(total_amount), 0)::numeric as total_invoiced,
                COALESCE(SUM(tax_amount), 0)::numeric as total_output_vat,
                COALESCE(SUM(balance_due), 0)::numeric as total_receivables,
                COUNT(*)::int as invoice_count
              FROM invoices
              WHERE tenant_id = $1 AND status != 'CANCELLED'
            `, [tenantId])
          : query(`
              SELECT 
                COALESCE(SUM(total_amount), 0)::numeric as total_invoiced,
                COALESCE(SUM(tax_amount), 0)::numeric as total_output_vat,
                COALESCE(SUM(balance_due), 0)::numeric as total_receivables,
                COUNT(*)::int as invoice_count
              FROM invoices
              WHERE status != 'CANCELLED'
            `),
        tenantId
          ? query(`
              SELECT 
                COALESCE(SUM(amount), 0)::numeric as total_collected,
                COUNT(*)::int as payment_count
              FROM payments
              WHERE tenant_id = $1 AND status = 'COMPLETED'
            `, [tenantId])
          : query(`
              SELECT 
                COALESCE(SUM(amount), 0)::numeric as total_collected,
                COUNT(*)::int as payment_count
              FROM payments
              WHERE status = 'COMPLETED'
            `),
        tenantId
          ? query(`
              SELECT 
                COALESCE(SUM(amount), 0)::numeric as total_expenses,
                COALESCE(SUM(vat_amount), 0)::numeric as total_input_vat,
                COUNT(*)::int as expense_count
              FROM expenses
              WHERE tenant_id = $1
            `, [tenantId])
          : query(`
              SELECT 
                COALESCE(SUM(amount), 0)::numeric as total_expenses,
                COALESCE(SUM(vat_amount), 0)::numeric as total_input_vat,
                COUNT(*)::int as expense_count
              FROM expenses
            `),
        tenantId
          ? query(`
              SELECT p.*, i.invoice_number, c.name as client_name
              FROM payments p
              JOIN invoices i ON p.invoice_id = i.id
              LEFT JOIN clients c ON i.client_id = c.id
              WHERE p.tenant_id = $1
              ORDER BY p.payment_date DESC
              LIMIT 10
            `, [tenantId])
          : query(`
              SELECT p.*, i.invoice_number, c.name as client_name
              FROM payments p
              JOIN invoices i ON p.invoice_id = i.id
              LEFT JOIN clients c ON i.client_id = c.id
              ORDER BY p.payment_date DESC
              LIMIT 10
            `),
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
        },
        recentPayments: recentPayments.rows,
        formatKES,
      });
    } catch (error) {
      accLogger.error('Failed to load accounting overview', { error: String(error) });
      next(error);
    }
  };
}

export default new AccountingController();
