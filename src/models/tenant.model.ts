// ══════════════════════════════════════════════════════════════════════
// Tenant Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Tenant, TaxType, DarajaShortcodeType, TenantDisplayFields } from './types';

export interface CreateTenantInput {
  id?: string;
  name: string;
  slug: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  kraPin?: string | null;
  vatRegistered?: boolean;
  defaultTaxType?: TaxType;
  logoUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  invoicePrefix?: string;
  quotePrefix?: string;
  invoiceTemplate?: string;
  displayFields?: TenantDisplayFields;
  invoiceNotes?: string | null;
  paymentTerms?: string | null;
  bankDetails?: string | null;
  darajaConsumerKey?: string | null;
  darajaConsumerSecret?: string | null;
  darajaPasskey?: string | null;
  darajaShortcode?: string | null;
  darajaShortcodeType?: DarajaShortcodeType;
  darajaEnvironment?: string;
  cardGatewayProvider?: string;
  cardPublicKey?: string | null;
  cardSecretKey?: string | null;
  cardEnabled?: boolean;
  receiptFields?: Record<string, any> | null;
}

export class TenantModel {
  private static mapRow(row: any): Tenant {
    let displayFields: TenantDisplayFields = {
      showTenantPhone: true,
      showTenantEmail: true,
      showTenantAddress: true,
      showTenantKraPin: true,
      showClientPhone: true,
      showClientEmail: true,
      showClientAddress: true,
      showClientKraPin: true,
      showBankDetails: true,
      showPaymentTerms: true,
      showMpesaDetails: true,
      showTaxBreakdown: true,
      showDiscount: true,
      showProject: true,
      showNotes: true,
      showTerms: true,
      showEtimsQr: true,
    };

    if (row.display_fields) {
      try {
        const parsed = typeof row.display_fields === 'string' ? JSON.parse(row.display_fields) : row.display_fields;
        displayFields = { ...displayFields, ...parsed };
      } catch {}
    }

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      country: row.country,
      kraPin: row.kra_pin,
      vatRegistered: row.vat_registered,
      defaultTaxType: row.default_tax_type,
      logoUrl: row.logo_url,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      accentColor: row.accent_color,
      invoicePrefix: row.invoice_prefix,
      quotePrefix: row.quote_prefix,
      invoiceTemplate: row.invoice_template || 'modern',
      displayFields,
      invoiceNotes: row.invoice_notes,
      paymentTerms: row.payment_terms,
      bankDetails: row.bank_details,
      darajaConsumerKey: row.daraja_consumer_key,
      darajaConsumerSecret: row.daraja_consumer_secret,
      darajaPasskey: row.daraja_passkey,
      darajaShortcode: row.daraja_shortcode,
      darajaShortcodeType: row.daraja_shortcode_type,
      darajaEnvironment: row.daraja_environment || 'sandbox',
      cardGatewayProvider: row.card_gateway_provider || 'STRIPE',
      cardPublicKey: row.card_public_key,
      cardSecretKey: row.card_secret_key,
      cardEnabled: Boolean(row.card_enabled),
      receiptFields: typeof row.receipt_fields === 'string' ? JSON.parse(row.receipt_fields) : row.receipt_fields,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Find tenant by ID
   */
  static async findById(id: string, client?: PoolClient): Promise<Tenant | null> {
    const sql = `
      SELECT * FROM tenants
      WHERE id = $1
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  /**
   * Find tenant by URL-safe slug
   */
  static async findBySlug(slug: string, client?: PoolClient): Promise<Tenant | null> {
    const sql = `
      SELECT * FROM tenants
      WHERE slug = $1
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [slug.toLowerCase().trim()]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  /**
   * Create a new tenant
   */
  static async create(data: CreateTenantInput, client?: PoolClient): Promise<Tenant> {
    const sql = `
      INSERT INTO tenants (
        id, name, slug, email, phone, address, city, country,
        kra_pin, vat_registered, default_tax_type, logo_url,
        primary_color, secondary_color, accent_color, invoice_prefix,
        quote_prefix, invoice_notes, payment_terms, bank_details,
        daraja_consumer_key, daraja_consumer_secret, daraja_passkey,
        daraja_shortcode, daraja_shortcode_type, daraja_environment, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23,
        $24, $25, $26, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.name.trim(),
      data.slug.toLowerCase().trim(),
      data.email.toLowerCase().trim(),
      data.phone || null,
      data.address || null,
      data.city || null,
      data.country || 'Kenya',
      data.kraPin || null,
      data.vatRegistered ?? false,
      data.defaultTaxType || TaxType.VAT_16,
      data.logoUrl || null,
      data.primaryColor || '#4F46E5',
      data.secondaryColor || '#1E293B',
      data.accentColor || '#06B6D4',
      data.invoicePrefix || 'INV',
      data.quotePrefix || 'QUO',
      data.invoiceNotes || null,
      data.paymentTerms || null,
      data.bankDetails || null,
      data.darajaConsumerKey || null,
      data.darajaConsumerSecret || null,
      data.darajaPasskey || null,
      data.darajaShortcode || null,
      data.darajaShortcodeType || DarajaShortcodeType.PAYBILL,
      data.darajaEnvironment || 'sandbox',
    ];

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  /**
   * Upsert tenant (for seed scripts)
   */
  static async upsert(data: CreateTenantInput, client?: PoolClient): Promise<Tenant> {
    const existing = await this.findBySlug(data.slug, client);
    if (existing) {
      return existing;
    }
    return await this.create(data, client);
  }

  /**
   * Update tenant configuration
   */
  static async update(id: string, data: Partial<CreateTenantInput>, client?: PoolClient): Promise<Tenant | null> {
    const sql = `
      UPDATE tenants SET
        name = COALESCE($2, name),
        phone = COALESCE($3, phone),
        address = COALESCE($4, address),
        city = COALESCE($5, city),
        kra_pin = COALESCE($6, kra_pin),
        vat_registered = COALESCE($7, vat_registered),
        invoice_prefix = COALESCE($8, invoice_prefix),
        quote_prefix = COALESCE($9, quote_prefix),
        invoice_notes = COALESCE($10, invoice_notes),
        payment_terms = COALESCE($11, payment_terms),
        bank_details = COALESCE($12, bank_details),
        daraja_shortcode = COALESCE($13, daraja_shortcode),
        daraja_shortcode_type = COALESCE($14, daraja_shortcode_type),
        daraja_environment = COALESCE($15, daraja_environment),
        primary_color = COALESCE($16, primary_color),
        invoice_template = COALESCE($17, invoice_template),
        logo_url = CASE WHEN CAST($18 AS TEXT) = '__NULL__' THEN NULL WHEN CAST($18 AS TEXT) IS NOT NULL THEN CAST($18 AS TEXT) ELSE logo_url END,
        secondary_color = COALESCE($19, secondary_color),
        accent_color = COALESCE($20, accent_color),
        display_fields = COALESCE($21::jsonb, display_fields),
        daraja_consumer_key = COALESCE($22, daraja_consumer_key),
        daraja_consumer_secret = COALESCE($23, daraja_consumer_secret),
        daraja_passkey = COALESCE($24, daraja_passkey),
        card_gateway_provider = COALESCE($25, card_gateway_provider),
        card_public_key = COALESCE($26, card_public_key),
        card_secret_key = COALESCE($27, card_secret_key),
        card_enabled = COALESCE($28, card_enabled),
        receipt_fields = COALESCE($29::jsonb, receipt_fields),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const values = [
      id,
      data.name || null,
      data.phone || null,
      data.address || null,
      data.city || null,
      data.kraPin || null,
      data.vatRegistered !== undefined ? data.vatRegistered : null,
      data.invoicePrefix || null,
      data.quotePrefix || null,
      data.invoiceNotes || null,
      data.paymentTerms || null,
      data.bankDetails || null,
      data.darajaShortcode || null,
      data.darajaShortcodeType || null,
      data.darajaEnvironment || null,
      data.primaryColor || null,
      data.invoiceTemplate || null,
      data.logoUrl !== undefined ? (data.logoUrl === '' || data.logoUrl === null ? '__NULL__' : data.logoUrl) : null,
      data.secondaryColor || null,
      data.accentColor || null,
      data.displayFields !== undefined ? JSON.stringify(data.displayFields) : null,
      data.darajaConsumerKey !== undefined ? data.darajaConsumerKey : null,
      data.darajaConsumerSecret !== undefined ? data.darajaConsumerSecret : null,
      data.darajaPasskey !== undefined ? data.darajaPasskey : null,
      data.cardGatewayProvider || null,
      data.cardPublicKey !== undefined ? data.cardPublicKey : null,
      data.cardSecretKey !== undefined ? data.cardSecretKey : null,
      data.cardEnabled !== undefined ? data.cardEnabled : null,
      data.receiptFields !== undefined ? JSON.stringify(data.receiptFields) : null,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }
}
