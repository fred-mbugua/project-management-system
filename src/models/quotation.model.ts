// ══════════════════════════════════════════════════════════════════════
// Quotation Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Quotation, QuotationItem, QuotationStatus, TaxType } from './types';

export interface CreateQuotationItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxType?: TaxType;
  taxRate?: number;
  lineTotal: number;
  lineTax?: number;
  sortOrder?: number;
}

export interface CreateQuotationInput {
  id?: string;
  tenantId: string;
  clientId: string;
  projectId?: string | null;
  quotationNumber: string;
  title?: string | null;
  status?: QuotationStatus;
  issueDate?: Date;
  validUntil: Date;
  subtotal?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  notes?: string | null;
  terms?: string | null;
  items?: CreateQuotationItemInput[];
}

export class QuotationModel {
  private static mapRow(row: any): Quotation {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      clientId: row.client_id,
      projectId: row.project_id,
      quotationNumber: row.quotation_number,
      title: row.title,
      status: row.status,
      issueDate: new Date(row.issue_date),
      validUntil: new Date(row.valid_until),
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      discountAmount: parseFloat(row.discount_amount),
      totalAmount: parseFloat(row.total_amount),
      notes: row.notes,
      terms: row.terms,
      convertedInvoiceId: row.converted_invoice_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private static mapItemRow(row: any): QuotationItem {
    return {
      id: row.id,
      quotationId: row.quotation_id,
      description: row.description,
      quantity: parseFloat(row.quantity),
      unitPrice: parseFloat(row.unit_price),
      discountPercent: parseFloat(row.discount_percent),
      taxType: row.tax_type,
      taxRate: parseFloat(row.tax_rate),
      lineTotal: parseFloat(row.line_total),
      lineTax: parseFloat(row.line_tax),
      sortOrder: row.sort_order,
    };
  }

  static async findById(id: string, client?: PoolClient): Promise<Quotation | null> {
    const sql = `SELECT * FROM quotations WHERE id = $1 LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByTenant(tenantId: string, client?: PoolClient): Promise<Quotation[]> {
    const sql = `SELECT * FROM quotations WHERE tenant_id = $1 ORDER BY created_at DESC`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId]);
    return res.rows.map(this.mapRow);
  }

  static async create(data: CreateQuotationInput, client?: PoolClient): Promise<Quotation> {
    const sql = `
      INSERT INTO quotations (
        id, tenant_id, client_id, project_id, quotation_number,
        title, status, issue_date, valid_until, subtotal,
        tax_amount, discount_amount, total_amount, notes, terms, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.clientId,
      data.projectId || null,
      data.quotationNumber,
      data.title || null,
      data.status || QuotationStatus.DRAFT,
      data.issueDate || new Date(),
      data.validUntil,
      data.subtotal || 0,
      data.taxAmount || 0,
      data.discountAmount || 0,
      data.totalAmount || 0,
      data.notes || null,
      data.terms || null,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    const quotation = this.mapRow(res.rows[0]);

    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        await this.addItem(quotation.id, item, client);
      }
    }

    return quotation;
  }

  static async addItem(
    quotationId: string,
    item: CreateQuotationItemInput,
    client?: PoolClient
  ): Promise<QuotationItem> {
    const sql = `
      INSERT INTO quotation_items (
        id, quotation_id, description, quantity, unit_price,
        discount_percent, tax_type, tax_rate, line_total, line_tax, sort_order
      ) VALUES (
        gen_random_uuid()::text,
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      RETURNING *
    `;
    const values = [
      quotationId,
      item.description,
      item.quantity,
      item.unitPrice,
      item.discountPercent || 0,
      item.taxType || TaxType.VAT_16,
      item.taxRate ?? 16,
      item.lineTotal,
      item.lineTax || 0,
      item.sortOrder || 0,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapItemRow(res.rows[0]);
  }
}
