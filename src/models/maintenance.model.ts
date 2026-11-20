// ══════════════════════════════════════════════════════════════════════
// Maintenance Schedule Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { MaintenanceFrequency, MaintenanceStatus, TaxType } from './types';

export interface MaintenanceContractDetail {
  id: string;
  tenantId: string;
  projectId?: string | null;
  clientId: string;
  title: string;
  description?: string | null;
  frequency: MaintenanceFrequency;
  intervalMonths: number;
  status: MaintenanceStatus;
  chargeAmount: number;
  taxType: TaxType;
  taxRate: number;
  startDate: Date;
  nextDueDate: Date;
  endDate?: Date | null;
  lastCompletedDate?: Date | null;
  lastInvoiceId?: string | null;
  autoInvoice: boolean;
  autoSendEmail: boolean;
  notifyDaysBefore: number;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  clientName?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
  lastInvoiceNumber?: string | null;
  invoiceCount?: number;
}

export interface UpdateMaintenanceScheduleInput {
  clientId: string;
  projectId?: string | null;
  title: string;
  frequency: MaintenanceFrequency;
  intervalMonths: number;
  status: MaintenanceStatus;
  chargeAmount: number;
  taxType: TaxType;
  taxRate: number;
  startDate: Date;
  nextDueDate: Date;
  endDate?: Date | null;
  autoInvoice: boolean;
  autoSendEmail: boolean;
  notifyDaysBefore: number;
  notes?: string | null;
}

export class MaintenanceModel {
  private static mapRow(row: any): MaintenanceContractDetail {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id || null,
      clientId: row.client_id,
      title: row.title,
      description: row.description || null,
      frequency: row.frequency as MaintenanceFrequency,
      intervalMonths: row.interval_months != null ? parseInt(String(row.interval_months), 10) : 1,
      status: row.status as MaintenanceStatus,
      chargeAmount: parseFloat(String(row.charge_amount || 0)),
      taxType: (row.tax_type || TaxType.VAT_16) as TaxType,
      taxRate: row.tax_rate != null ? parseFloat(String(row.tax_rate)) : 16,
      startDate: new Date(row.startdate || row.start_date),
      nextDueDate: new Date(row.next_due_date),
      endDate: row.end_date ? new Date(row.end_date) : null,
      lastCompletedDate: row.last_completed_date ? new Date(row.last_completed_date) : null,
      lastInvoiceId: row.last_invoice_id || null,
      autoInvoice: row.auto_invoice !== false,
      autoSendEmail: row.auto_send_email !== false,
      notifyDaysBefore: row.notify_days_before != null ? parseInt(String(row.notify_days_before), 10) : 3,
      notes: row.notes || null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      clientName: row.client_name || null,
      projectName: row.project_name || null,
      projectCode: row.project_code || null,
      lastInvoiceNumber: row.last_invoice_number || null,
      invoiceCount: row.invoice_count != null ? parseInt(String(row.invoice_count), 10) : 0,
    };
  }

  static async findByIdAndTenant(
    id: string,
    tenantId: string | null,
    client?: PoolClient
  ): Promise<MaintenanceContractDetail | null> {
    const params: any[] = [id];
    const tenantFilter = tenantId ? (params.push(tenantId), ` AND m.tenant_id = $2`) : '';
    const sql = `
      SELECT
        m.*,
        c.name as client_name,
        p.name as project_name,
        p.code as project_code,
        inv.invoice_number as last_invoice_number,
        (SELECT COUNT(*)::int FROM invoices i WHERE i.recurring_schedule_id = m.id) as invoice_count
      FROM maintenance_schedules m
      LEFT JOIN clients c ON m.client_id = c.id
      LEFT JOIN projects p ON m.project_id = p.id
      LEFT JOIN invoices inv ON m.last_invoice_id = inv.id
      WHERE m.id = $1${tenantFilter}
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, params);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async update(
    id: string,
    tenantId: string | null,
    data: UpdateMaintenanceScheduleInput,
    client?: PoolClient
  ): Promise<MaintenanceContractDetail | null> {
    const values: any[] = [
      data.clientId,
      data.projectId || null,
      data.title.trim(),
      data.frequency,
      data.intervalMonths,
      data.status,
      data.chargeAmount,
      data.taxType,
      data.taxRate,
      data.startDate,
      data.nextDueDate,
      data.endDate || null,
      data.autoInvoice,
      data.autoSendEmail,
      data.notifyDaysBefore,
      data.notes ?? null,
      id,
    ];
    const tenantFilter = tenantId ? (values.push(tenantId), ` AND tenant_id = $18`) : '';
    const sql = `
      UPDATE maintenance_schedules SET
        client_id = $1,
        project_id = $2,
        title = $3,
        frequency = $4::maintenance_frequency,
        interval_months = $5,
        status = $6::maintenance_status,
        charge_amount = $7,
        tax_type = $8::tax_type,
        tax_rate = $9,
        startdate = $10,
        next_due_date = $11,
        end_date = $12,
        auto_invoice = $13,
        auto_send_email = $14,
        notify_days_before = $15,
        notes = $16,
        updated_at = NOW()
      WHERE id = $17${tenantFilter}
      RETURNING *
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }
}
