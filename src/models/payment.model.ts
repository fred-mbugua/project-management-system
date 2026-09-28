// ══════════════════════════════════════════════════════════════════════
// Payment Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Payment, PaymentMethod, PaymentStatus } from './types';

export interface CreatePaymentInput {
  id?: string;
  tenantId: string;
  invoiceId: string;
  amount: number;
  paymentMethod?: PaymentMethod;
  status?: PaymentStatus;
  paymentDate?: Date;
  receiptNumber?: string | null;
  mpesaReceiptNumber?: string | null;
  mpesaPhoneNumber?: string | null;
  mpesaTransactionDate?: string | null;
  mpesaCheckoutRequestId?: string | null;
  mpesaMerchantRequestId?: string | null;
  referenceNumber?: string | null;
  proofUrl?: string | null;
  proofFilename?: string | null;
  recordedByUserId?: string | null;
  notes?: string | null;
  rawCallbackData?: any;
}

export class PaymentModel {
  private static mapRow(row: any): Payment {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      invoiceId: row.invoice_id,
      amount: parseFloat(row.amount),
      paymentMethod: row.payment_method,
      status: row.status,
      paymentDate: new Date(row.payment_date),
      receiptNumber: row.receipt_number,
      mpesaReceiptNumber: row.mpesa_receipt_number,
      mpesaPhoneNumber: row.mpesa_phone_number,
      mpesaTransactionDate: row.mpesa_transaction_date,
      mpesaCheckoutRequestId: row.mpesa_checkout_request_id,
      mpesaMerchantRequestId: row.mpesa_merchant_request_id,
      referenceNumber: row.reference_number,
      proofUrl: row.proof_url,
      proofFilename: row.proof_filename,
      recordedByUserId: row.recorded_by_user_id,
      notes: row.notes,
      rawCallbackData: row.raw_callback_data,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  static async findById(id: string, client?: PoolClient): Promise<Payment | null> {
    const sql = `SELECT * FROM payments WHERE id = $1 LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByInvoice(invoiceId: string, client?: PoolClient): Promise<Payment[]> {
    const sql = `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [invoiceId]);
    return res.rows.map(this.mapRow);
  }

  static async create(data: CreatePaymentInput, client?: PoolClient): Promise<Payment> {
    const sql = `
      INSERT INTO payments (
        id, tenant_id, invoice_id, amount, payment_method,
        status, payment_date, receipt_number, mpesa_receipt_number, mpesa_phone_number,
        mpesa_transaction_date, mpesa_checkout_request_id, mpesa_merchant_request_id,
        reference_number, proof_url, proof_filename, recorded_by_user_id,
        notes, raw_callback_data, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.invoiceId,
      data.amount,
      data.paymentMethod || PaymentMethod.MPESA_STK,
      data.status || PaymentStatus.PENDING,
      data.paymentDate || new Date(),
      data.receiptNumber || null,
      data.mpesaReceiptNumber || null,
      data.mpesaPhoneNumber || null,
      data.mpesaTransactionDate || null,
      data.mpesaCheckoutRequestId || null,
      data.mpesaMerchantRequestId || null,
      data.referenceNumber || null,
      data.proofUrl || null,
      data.proofFilename || null,
      data.recordedByUserId || null,
      data.notes || null,
      data.rawCallbackData ? JSON.stringify(data.rawCallbackData) : null,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }
}
