// ══════════════════════════════════════════════════════════════════════
// Expense Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ExpenseModel } from '../models/expense.model';
import { ExpenseCategory } from '../models/types';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const expenseLogger = logger.child('ExpenseController');

export class ExpenseController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const [expensesRes, projectsRes, statsRes] = await Promise.all([
        tenantId
          ? query(`
              SELECT e.*, p.name as project_name, p.code as project_code
              FROM expenses e
              LEFT JOIN projects p ON e.project_id = p.id
              WHERE e.tenant_id = $1
              ORDER BY e.expense_date DESC
            `, [tenantId])
          : query(`
              SELECT e.*, p.name as project_name, p.code as project_code
              FROM expenses e
              LEFT JOIN projects p ON e.project_id = p.id
              ORDER BY e.expense_date DESC
            `),
        tenantId
          ? query(`SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' ORDER BY name ASC`, [tenantId])
          : query(`SELECT id, name, code FROM projects WHERE status != 'CANCELLED' ORDER BY name ASC`),
        tenantId
          ? query(`
              SELECT 
                COALESCE(SUM(amount), 0)::numeric as total_amount,
                COALESCE(SUM(vat_amount), 0)::numeric as total_vat,
                COUNT(*)::int as total_count
              FROM expenses 
              WHERE tenant_id = $1
            `, [tenantId])
          : query(`
              SELECT 
                COALESCE(SUM(amount), 0)::numeric as total_amount,
                COALESCE(SUM(vat_amount), 0)::numeric as total_vat,
                COUNT(*)::int as total_count
              FROM expenses
            `),
      ]);

      res.render('pages/expenses/index', {
        title: 'Expenses',
        expenses: expensesRes.rows,
        projects: projectsRes.rows,
        categories: Object.values(ExpenseCategory),
        stats: statsRes.rows[0],
        formatKES,
      });
    } catch (error) {
      expenseLogger.error('Failed to list expenses', { error: String(error) });
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

      const { description, category, amount, vatAmount, projectId, vendor, referenceNo, billable } = req.body;

      if (!description || !amount) {
        req.flash('error', 'Description and amount are required.');
        res.redirect('/expenses');
        return;
      }

      await ExpenseModel.create({
        tenantId,
        projectId: projectId || null,
        category: category as ExpenseCategory,
        description,
        amount: parseFloat(amount) || 0,
        vatAmount: parseFloat(vatAmount) || 0,
        vendor: vendor || null,
        referenceNo: referenceNo || null,
        billable: billable === 'on' || billable === 'true',
        expenseDate: new Date(),
      });

      req.flash('success', 'Expense recorded successfully.');
      res.redirect('/expenses');
    } catch (error) {
      expenseLogger.error('Failed to create expense', { error: String(error) });
      next(error);
    }
  };
}

export default new ExpenseController();
