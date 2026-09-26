// ══════════════════════════════════════════════════════════════════════
// Expense Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Expense, ExpenseCategory } from './types';

export interface CreateExpenseInput {
  id?: string;
  tenantId: string;
  projectId?: string | null;
  category?: ExpenseCategory;
  description: string;
  amount: number;
  vatAmount?: number;
  taxDeductible?: boolean;
  billable?: boolean;
  receiptUrl?: string | null;
  expenseDate?: Date;
  vendor?: string | null;
  referenceNo?: string | null;
  notes?: string | null;
}

export class ExpenseModel {
  private static mapRow(row: any): Expense {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      category: row.category,
      description: row.description,
      amount: parseFloat(row.amount),
      vatAmount: parseFloat(row.vat_amount),
      taxDeductible: row.tax_deductible,
      billable: row.billable,
      receiptUrl: row.receipt_url,
      expenseDate: new Date(row.expense_date),
      vendor: row.vendor,
      referenceNo: row.reference_no,
      notes: row.notes,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  static async findById(id: string, client?: PoolClient): Promise<Expense | null> {
    const sql = `SELECT * FROM expenses WHERE id = $1 LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByTenant(tenantId: string, client?: PoolClient): Promise<Expense[]> {
    const sql = `SELECT * FROM expenses WHERE tenant_id = $1 ORDER BY expense_date DESC`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId]);
    return res.rows.map(this.mapRow);
  }

  static async create(data: CreateExpenseInput, client?: PoolClient): Promise<Expense> {
    const sql = `
      INSERT INTO expenses (
        id, tenant_id, project_id, category, description,
        amount, vat_amount, tax_deductible, billable,
        receipt_url, expense_date, vendor, reference_no, notes, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.projectId || null,
      data.category || ExpenseCategory.MISCELLANEOUS,
      data.description,
      data.amount,
      data.vatAmount || 0,
      data.taxDeductible ?? false,
      data.billable ?? false,
      data.receiptUrl || null,
      data.expenseDate || new Date(),
      data.vendor || null,
      data.referenceNo || null,
      data.notes || null,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  static async createMany(expenses: CreateExpenseInput[], client?: PoolClient): Promise<Expense[]> {
    const results: Expense[] = [];
    for (const exp of expenses) {
      results.push(await this.create(exp, client));
    }
    return results;
  }
}
