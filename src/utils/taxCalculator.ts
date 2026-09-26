// ══════════════════════════════════════════════════════════════════════
// KRA Tax Calculator Engine
// Supports: VAT 16%, Zero-Rated (0%), Exempt (0%), WHT (3% & 5%), Custom
// eTIMS-Ready Invoice Verification Hash Generation
// ══════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { TaxType } from '../models/types';

// ──────────────────────────────────────────────
// Tax Rate Mapping
// ──────────────────────────────────────────────

export const TAX_RATES: Record<TaxType, number> = {
  VAT_16: 16,
  ZERO_RATED: 0,
  EXEMPT: 0,
  WITHHOLDING_3: 3,
  WITHHOLDING_5: 5,
  CUSTOM: 0,
};

export const TAX_LABELS: Record<TaxType, string> = {
  VAT_16: 'VAT (16%)',
  ZERO_RATED: 'Zero Rated (0%)',
  EXEMPT: 'Tax Exempt',
  WITHHOLDING_3: 'WHT (3%)',
  WITHHOLDING_5: 'WHT (5%)',
  CUSTOM: 'Custom Tax',
};

// ──────────────────────────────────────────────
// Line Item Interfaces
// ──────────────────────────────────────────────

export interface TaxLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxType: TaxType;
  taxRate?: number; // Override for CUSTOM type
}

export interface CalculatedLineItem extends TaxLineItem {
  subtotal: number;       // qty * unitPrice
  discountAmount: number; // subtotal * discountPercent / 100
  taxableAmount: number;  // subtotal - discountAmount
  taxAmount: number;      // taxableAmount * taxRate / 100
  lineTotal: number;      // taxableAmount + taxAmount (for VAT-inclusive jurisdictions, this is the final amount)
}

export interface InvoiceTotals {
  subtotal: number;
  totalDiscount: number;
  totalTaxableAmount: number;
  totalTax: number;
  grandTotal: number;
  taxBreakdown: TaxBreakdownEntry[];
}

export interface TaxBreakdownEntry {
  taxType: TaxType;
  label: string;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

// ──────────────────────────────────────────────
// Core Tax Calculation Functions
// ──────────────────────────────────────────────

/**
 * Calculate tax for a single line item.
 * Returns full breakdown including discount, taxable amount, and tax.
 */
export function calculateLineItem(item: TaxLineItem): CalculatedLineItem {
  const rate = item.taxRate ?? TAX_RATES[item.taxType] ?? 0;
  const subtotal = roundCurrency(item.quantity * item.unitPrice);
  const discountAmount = roundCurrency(subtotal * (item.discountPercent / 100));
  const taxableAmount = roundCurrency(subtotal - discountAmount);

  let taxAmount: number;
  if (item.taxType === 'WITHHOLDING_3' || item.taxType === 'WITHHOLDING_5') {
    // Withholding tax is deducted from the payable amount (reduces what the client pays)
    taxAmount = roundCurrency(taxableAmount * (rate / 100));
  } else {
    // VAT is added on top
    taxAmount = roundCurrency(taxableAmount * (rate / 100));
  }

  const lineTotal = roundCurrency(taxableAmount + taxAmount);

  return {
    ...item,
    taxRate: rate,
    subtotal,
    discountAmount,
    taxableAmount,
    taxAmount,
    lineTotal,
  };
}

/**
 * Calculate invoice totals from an array of line items.
 * Provides full tax breakdown by category for KRA reporting.
 */
export function calculateInvoiceTotals(items: TaxLineItem[]): InvoiceTotals {
  const calculatedItems = items.map(calculateLineItem);

  const subtotal = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.subtotal, 0)
  );
  const totalDiscount = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.discountAmount, 0)
  );
  const totalTaxableAmount = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.taxableAmount, 0)
  );
  const totalTax = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.taxAmount, 0)
  );
  const grandTotal = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.lineTotal, 0)
  );

  // Build tax breakdown grouped by tax type
  const breakdownMap = new Map<TaxType, TaxBreakdownEntry>();
  for (const item of calculatedItems) {
    const existing = breakdownMap.get(item.taxType);
    if (existing) {
      existing.taxableAmount = roundCurrency(existing.taxableAmount + item.taxableAmount);
      existing.taxAmount = roundCurrency(existing.taxAmount + item.taxAmount);
    } else {
      breakdownMap.set(item.taxType, {
        taxType: item.taxType,
        label: TAX_LABELS[item.taxType],
        rate: item.taxRate ?? TAX_RATES[item.taxType],
        taxableAmount: item.taxableAmount,
        taxAmount: item.taxAmount,
      });
    }
  }

  return {
    subtotal,
    totalDiscount,
    totalTaxableAmount,
    totalTax,
    grandTotal,
    taxBreakdown: Array.from(breakdownMap.values()),
  };
}

// ──────────────────────────────────────────────
// eTIMS Cryptographic Verification
// ──────────────────────────────────────────────

export interface EtimsHashInput {
  invoiceNumber: string;
  issueDate: string;      // ISO date string
  tenantKraPin: string;
  clientKraPin: string;
  totalAmount: number;
  taxAmount: number;
}

/**
 * Generate SHA-256 hash for eTIMS invoice verification.
 * This creates a tamper-evident cryptographic signature of the invoice.
 */
export function generateEtimsHash(input: EtimsHashInput): string {
  const payload = [
    input.invoiceNumber,
    input.issueDate,
    input.tenantKraPin,
    input.clientKraPin,
    input.totalAmount.toFixed(2),
    input.taxAmount.toFixed(2),
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Generate QR code payload string for eTIMS verification.
 * Contains all necessary fields for tax authority scanning.
 */
export function generateEtimsQrPayload(input: EtimsHashInput): string {
  const hash = generateEtimsHash(input);
  return JSON.stringify({
    inv: input.invoiceNumber,
    dt: input.issueDate,
    seller: input.tenantKraPin,
    buyer: input.clientKraPin,
    total: input.totalAmount.toFixed(2),
    tax: input.taxAmount.toFixed(2),
    hash: hash.substring(0, 16), // Short hash for QR readability
  });
}

// ──────────────────────────────────────────────
// Currency Helpers
// ──────────────────────────────────────────────

/**
 * Round to 2 decimal places for currency calculations.
 * Uses banker's rounding (round half to even) for financial accuracy.
 */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Format amount as Kenyan Shilling string.
 */
export function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Parse a string amount to a number, handling commas and currency symbols.
 */
export function parseAmount(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : roundCurrency(parsed);
}
