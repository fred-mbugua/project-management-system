// ══════════════════════════════════════════════════════════════════════
// Invoice Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Invoice, InvoiceItem, InvoiceStatus, TaxType } from './types';

export interface CreateInvoiceItemInput {
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

export interface CreateInvoiceInput {
  id?: string;
  tenantId: string;
  clientId: string;
  projectId?: string | null;
  quotationId?: string | null;
  invoiceNumber: string;
  title?: string | null;
  status?: InvoiceStatus;
  issueDate?: Date;
  dueDate: Date;
  subtotal?: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount?: number;
  amountPaid?: number;
  balanceDue?: number;
  notes?: string | null;
  terms?: string | null;
  template?: string;
  etimsVerificationHash?: string | null;
  etimsQrPayload?: string | null;
  tenantKraPin?: string | null;
  clientKraPin?: string | null;
  includeVat?: boolean;
  items?: CreateInvoiceItemInput[];
}

export class InvoiceModel {
  private static mapRow(row: any): Invoice {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      clientId: row.client_id,
      projectId: row.project_id,
      quotationId: row.quotation_id,
      invoiceNumber: row.invoice_number,
      title: row.title,
      status: row.status,
      issueDate: new Date(row.issue_date),
      dueDate: new Date(row.due_date),
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      discountAmount: parseFloat(row.discount_amount),
      totalAmount: parseFloat(row.total_amount),
      amountPaid: parseFloat(row.amount_paid),
      balanceDue: parseFloat(row.balance_due),
      notes: row.notes,
      terms: row.terms,
      template: row.template,
      etimsVerificationHash: row.etims_verification_hash,
      etimsQrPayload: row.etims_qr_payload,
      tenantKraPin: row.tenant_kra_pin,
      clientKraPin: row.client_kra_pin,
      includeVat: row.include_vat !== false,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private static mapItemRow(row: any): InvoiceItem {
    return {
      id: row.id,
      invoiceId: row.invoice_id,
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

  static async findById(id: string, client?: PoolClient): Promise<Invoice | null> {
    const sql = `SELECT * FROM invoices WHERE id = $1 LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByTenant(tenantId: string, client?: PoolClient): Promise<Invoice[]> {
    const sql = `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId]);
    return res.rows.map(this.mapRow);
  }

  static async create(data: CreateInvoiceInput, client?: PoolClient): Promise<Invoice> {
    const sql = `
      INSERT INTO invoices (
        id, tenant_id, client_id, project_id, quotation_id,
        invoice_number, title, status, issue_date, due_date,
        subtotal, tax_amount, discount_amount, total_amount,
        amount_paid, balance_due, notes, terms, template,
        etims_verification_hash, etims_qr_payload, tenant_kra_pin, client_kra_pin, include_vat, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.clientId,
      data.projectId || null,
      data.quotationId || null,
      data.invoiceNumber,
      data.title || null,
      data.status || InvoiceStatus.DRAFT,
      data.issueDate || new Date(),
      data.dueDate,
      data.subtotal || 0,
      data.taxAmount || 0,
      data.discountAmount || 0,
      data.totalAmount || 0,
      data.amountPaid || 0,
      data.balanceDue != null ? data.balanceDue : data.totalAmount || 0,
      data.notes || null,
      data.terms || null,
      data.template || 'modern',
      data.etimsVerificationHash || null,
      data.etimsQrPayload || null,
      data.tenantKraPin || null,
      data.clientKraPin || null,
      data.includeVat !== false,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    const invoice = this.mapRow(res.rows[0]);

    if (data.items && data.items.length > 0) {
      for (const item of data.items) {
        await this.addItem(invoice.id, item, client);
      }
    }

    return invoice;
  }

  static async addItem(
    invoiceId: string,
    item: CreateInvoiceItemInput,
    client?: PoolClient
  ): Promise<InvoiceItem> {
    const sql = `
      INSERT INTO invoice_items (
        id, invoice_id, description, quantity, unit_price,
        discount_percent, tax_type, tax_rate, line_total, line_tax, sort_order
      ) VALUES (
        gen_random_uuid()::text,
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      RETURNING *
    `;
    const values = [
      invoiceId,
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
