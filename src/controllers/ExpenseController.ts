// ══════════════════════════════════════════════════════════════════════
// Expense Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ExpenseModel } from '../models/expense.model';
import { ExpenseCategory } from '../models/types';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
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

      const params = extractPaginationParams(req, 10);
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (tenantId && !isSuper) {
        conditions.push(`e.tenant_id = $${paramIdx++}`);
        values.push(tenantId);
      }

      if (params.search) {
        conditions.push(`(
          e.description ILIKE $${paramIdx} OR
          e.vendor ILIKE $${paramIdx} OR
          e.reference_no ILIKE $${paramIdx} OR
          p.name ILIKE $${paramIdx} OR
          p.code ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`e.expense_date >= $${paramIdx++}::date`);
        values.push(params.startDate);
      }

      if (params.endDate) {
        conditions.push(`e.expense_date <= $${paramIdx++}::date`);
        values.push(params.endDate);
      }

      if (req.query.category) {
        conditions.push(`e.category = $${paramIdx++}`);
        values.push(req.query.category);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count query
      const countSql = `
        SELECT COUNT(*)::int as total
        FROM expenses e
        LEFT JOIN projects p ON e.project_id = p.id
        ${whereClause}
      `;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

      // Data query with pagination, newest first
      const dataSql = `
        SELECT e.*, p.name as project_name, p.code as project_code
        FROM expenses e
        LEFT JOIN projects p ON e.project_id = p.id
        ${whereClause}
        ORDER BY e.expense_date DESC, e.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];

      const [expensesRes, projectsRes, statsRes] = await Promise.all([
        query(dataSql, dataValues),
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

      const pagination = calculatePagination(total, params, req);

      res.render('pages/expenses/index', {
        title: 'Expenses',
        expenses: expensesRes.rows,
        projects: projectsRes.rows,
        categories: Object.values(ExpenseCategory),
        stats: statsRes.rows[0],
        pagination,
        filters: { ...params, category: req.query.category },
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
