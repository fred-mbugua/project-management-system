// ══════════════════════════════════════════════════════════════════════
// High-Fidelity Multi-Template Document PDF Generation Service
// Renders exact HTML/CSS templates via headless Chrome / Edge
// with automatic high-fidelity fallback to native PDFKit generator
// ══════════════════════════════════════════════════════════════════════

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { PassThrough } from 'stream';
import axios from 'axios';
import puppeteer, { Browser } from 'puppeteer-core';
import { Response } from 'express';
import { formatKES } from '../utils/taxCalculator';
import { TenantDisplayFields } from '../models/types';
import logger from '../utils/logger';

const pdfLogger = logger.child('PdfService');

export interface DocumentPdfData {
  type: 'invoice' | 'quotation';
  documentNumber: string;
  title?: string;
  status: string;
  issueDate: Date | string;
  dueDateOrValidUntil: Date | string;
  dueDateLabel: 'Due Date' | 'Valid Until';
  notes?: string | null;
  terms?: string | null;
  template?: string;
  customColor?: string | null;
  displayFields?: TenantDisplayFields;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount?: number | string;
  totalAmount: number | string;
  amountPaid?: number | string;
  balanceDue?: number | string;
  includeVat?: boolean;
  etimsHash?: string | null;
  tenant: {
    name: string;
    email?: string;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    kraPin?: string | null;
    logoUrl?: string | null;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    bankDetails?: string | null;
    darajaShortcode?: string | null;
    darajaShortcodeType?: string | null;
  };
  client: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    kraPin?: string | null;
  };
  project?: {
    name: string;
    code: string;
  } | null;
  items: Array<{
    description: string;
    quantity: number | string;
    unitPrice: number | string;
    lineTax?: number | string;
    lineTotal: number | string;
  }>;
}

export interface ReceiptPdfData {
  receiptNumber: string;
  invoiceNumber: string;
  paymentDate: Date | string;
  paymentMethod: string;
  paymentReference: string;
  amountPaid: number | string;
  totalInvoiceAmount: number | string;
  balanceDue: number | string;
  tenant: {
    name: string;
    email?: string;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    kraPin?: string | null;
    logoUrl?: string | null;
    primaryColor?: string;
    bankDetails?: string | null;
    darajaShortcode?: string | null;
    darajaShortcodeType?: string | null;
  };
  client: {
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    kraPin?: string | null;
  };
  project?: {
    name: string;
    code: string;
  } | null;
  items?: Array<{
    description: string;
    quantity: number | string;
    unitPrice: number | string;
    lineTotal: number | string;
  }>;
  receiptFields?: {
    showTenantKraPin?: boolean;
    showBankDetails?: boolean;
    showMpesaRef?: boolean;
    showProject?: boolean;
    showClientPhone?: boolean;
    showClientAddress?: boolean;
    showNotes?: boolean;
    receiptFooterNote?: string;
  };
}

export class PdfService {
  private browserInstance: Browser | null = null;
  private cachedCss: string | null = null;

  /**
   * Locate Chrome or Edge executable on host system
   */
  public findBrowserExecutable(): string | null {
    const candidatePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_BIN,
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
      '/usr/bin/chromium-headless',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe') : '',
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    try {
      const found = execSync('which google-chrome-stable || which google-chrome || which chromium-browser || which chromium', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
      if (found && fs.existsSync(found)) {
        return found;
      }
    } catch {}

    return null;
  }

  /**
   * Acquire or reuse a headless browser instance
   */
  private async getBrowser(): Promise<Browser | null> {
    if (this.browserInstance && this.browserInstance.connected) {
      return this.browserInstance;
    }

    const execPath = this.findBrowserExecutable();
    if (!execPath) {
      pdfLogger.warn('No Chrome/Edge executable found on system. Using template-faithful PDFKit engine.');
      return null;
    }

    try {
      this.browserInstance = await puppeteer.launch({
        executablePath: execPath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--no-first-run',
          '--no-zygote',
        ],
      });

      this.browserInstance.on('disconnected', () => {
        this.browserInstance = null;
      });

      return this.browserInstance;
    } catch (err: any) {
      pdfLogger.warn('Failed to launch headless browser for PDF rendering', { error: err?.message });
      this.browserInstance = null;
      return null;
    }
  }

  /**
   * Retrieve embedded stylesheets to ensure identical styling in print
   */
  private getEmbeddedCss(): string {
    if (!this.cachedCss) {
      try {
        const appCssPath = path.join(process.cwd(), 'public/css/app.css');
        const compCssPath = path.join(process.cwd(), 'public/css/components.css');
        const appCss = fs.existsSync(appCssPath) ? fs.readFileSync(appCssPath, 'utf8') : '';
        const compCss = fs.existsSync(compCssPath) ? fs.readFileSync(compCssPath, 'utf8') : '';
        this.cachedCss = `${appCss}\n${compCss}`;
      } catch (err) {
        pdfLogger.error('Failed reading CSS files for document PDF embedding', { error: String(err) });
        this.cachedCss = '';
      }
    }
    return this.cachedCss;
  }

  /**
   * Convert logo URL into base64 Data URI for instant rendering
   */
  private async getLogoDataUri(logoUrl?: string | null): Promise<string | null> {
    if (!logoUrl) return null;

    try {
      if (logoUrl.startsWith('data:image')) {
        return logoUrl;
      }

      if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        const response = await axios.get(logoUrl, {
          responseType: 'arraybuffer',
          timeout: 4000,
        });
        const contentType = response.headers['content-type'] || 'image/png';
        const base64 = Buffer.from(response.data).toString('base64');
        return `data:${contentType};base64,${base64}`;
      } else {
        const cleanPath = logoUrl.startsWith('/') ? logoUrl.slice(1) : logoUrl;
        const fullPath = path.join(process.cwd(), 'public', cleanPath);
        if (fs.existsSync(fullPath)) {
          const ext = path.extname(fullPath).toLowerCase();
          const mime = ext === '.svg' ? 'image/svg+xml' : (ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png');
          const base64 = fs.readFileSync(fullPath).toString('base64');
          return `data:${mime};base64,${base64}`;
        }
      }
    } catch (err: any) {
      pdfLogger.warn('Could not load logo as data URI', { logoUrl, error: err.message });
    }
    return null;
  }

  /**
   * Sanitizes string by converting Windows CRLF to standard LF,
   * removing literal 'Ð' characters and non-printable control codes.
   */
  public cleanText(str: any): string {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\u00D0/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  private escapeHtml(str: any): string {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private formatNumber(amount: any): string {
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount)) || 0;
    return num.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private formatDate(d: any): string {
    if (!d) return '';
    const dateObj = typeof d === 'string' ? new Date(d) : d;
    return isNaN(dateObj.getTime())
      ? String(d)
      : dateObj.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  /**
   * Generates the standalone HTML document representing the exact web sheet
   */
  public async generateDocumentHtml(data: DocumentPdfData): Promise<string> {
    const template = (data.template || 'modern').toLowerCase();
    const primaryColor = data.customColor || data.tenant?.primaryColor || '#4F46E5';
    const df: TenantDisplayFields = {
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
      ...(data.displayFields || {}),
    };

    const isInvoice = data.type === 'invoice';
    const docTypeLabel = isInvoice ? 'Tax Invoice' : 'Commercial Quotation';
    const clientHeading = isInvoice ? 'Billed To:' : 'Estimate Prepared For:';
    const totalHeading = isInvoice ? 'Grand Total:' : 'Estimated Total:';

    const tenantName = this.escapeHtml(this.cleanText(data.tenant.name || 'Organization'));
    const clientName = this.escapeHtml(this.cleanText(data.client.name || 'Valued Client'));

    const logoDataUri = await this.getLogoDataUri(data.tenant.logoUrl);
    let logoHtml = '';
    if (logoDataUri) {
      logoHtml = `<div class="doc-logo-wrapper" style="margin-bottom: 12px;">
        <img src="${logoDataUri}" alt="${tenantName} Logo" class="doc-brand-logo" style="max-height: 60px; max-width: 220px; object-fit: contain;">
      </div>`;
    }

    const isPaid = data.status === 'PAID';
    const statusText = isInvoice ? (isPaid ? 'PAID' : 'UNPAID') : data.status;
    const statusBadgeClass = isInvoice
      ? (isPaid ? 'badge-success invoice-status-paid' : 'badge-danger invoice-status-unpaid')
      : (data.status === 'CONVERTED' ? 'badge-success' : (data.status === 'SENT' ? 'badge-info' : (data.status === 'REJECTED' ? 'badge-danger' : 'badge-subtle')));

    const statusBadge = `<span class="badge ${statusBadgeClass}" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 800; letter-spacing: 0.08em; font-size: 11px; padding: 5px 12px; border-radius: 6px; text-transform: uppercase;">
      <span class="badge-dot" style="width: 7px; height: 7px; border-radius: 50%; display: inline-block; background-color: ${isInvoice ? (isPaid ? '#10b981' : '#ef4444') : '#64748b'};"></span>
      ${this.escapeHtml(statusText)}
    </span>`;

    const hasVat = isInvoice
      ? (data.includeVat !== false && parseFloat(String(data.taxAmount || 0)) > 0)
      : true;

    // Render table rows matching show.ejs
    let itemsRows = '';
    if (isInvoice) {
      // Invoices table: Item Description | Qty | Unit Price | VAT (16%) | Amount
      itemsRows = data.items.map((it) => {
        const qty = parseFloat(String(it.quantity)) || 1;
        const price = parseFloat(String(it.unitPrice)) || 0;
        const lineTax = (it.lineTax !== undefined && it.lineTax !== null)
          ? parseFloat(String(it.lineTax))
          : (hasVat ? qty * price * 0.16 : 0);
        const lineTotal = (it.lineTotal !== undefined && it.lineTotal !== null)
          ? parseFloat(String(it.lineTotal))
          : qty * price * (hasVat ? 1.16 : 1);

        return `<tr>
          <td><strong>${this.escapeHtml(this.cleanText(it.description))}</strong></td>
          <td class="text-center">${qty}</td>
          <td class="text-right">${formatKES(price)}</td>
          ${(hasVat && df.showTaxBreakdown !== false) ? `<td class="text-right">${formatKES(lineTax)}</td>` : ''}
          <td class="text-right font-semibold">${formatKES(lineTotal)}</td>
        </tr>`;
      }).join('');
    } else {
      // Quotations table: # | Item & Service Description | Qty | Unit Price | Tax Rate | Total (KES)
      itemsRows = data.items.map((it, idx) => {
        const qty = parseFloat(String(it.quantity)) || 1;
        const price = parseFloat(String(it.unitPrice)) || 0;
        const lineTotal = it.lineTotal
          ? parseFloat(String(it.lineTotal))
          : qty * price * (df.showTaxBreakdown !== false ? 1.16 : 1);

        return `<tr>
          <td>${idx + 1}</td>
          <td><strong>${this.escapeHtml(this.cleanText(it.description))}</strong></td>
          <td class="text-right">${qty}</td>
          <td class="text-right">${formatKES(price)}</td>
          ${df.showTaxBreakdown !== false ? `<td class="text-right"><span class="badge badge-subtle">16% VAT</span></td>` : ''}
          <td class="text-right font-bold">${formatKES(lineTotal)}</td>
        </tr>`;
      }).join('');
    }

    const hasBank = df.showBankDetails !== false && data.tenant.bankDetails;
    const hasMpesa = df.showMpesaDetails !== false && data.tenant.darajaShortcode;
    const settlementHtml = (hasBank || hasMpesa) ? `
      <div class="invoice-settlement-card mb-6">
        <h4 class="invoice-settlement-title">
          <i class="uil uil-credit-card text-primary"></i>
          <span>Payment &amp; Settlement Details</span>
        </h4>
        <div class="invoice-settlement-grid">
          ${hasBank ? `
            <div class="settlement-grid-item">
              <span class="settlement-label">Bank Settlement Account:</span>
              <p class="settlement-value" style="white-space: pre-line;">${this.escapeHtml(this.cleanText(data.tenant.bankDetails))}</p>
            </div>
          ` : ''}
          ${hasMpesa ? `
            <div class="settlement-grid-item">
              <span class="settlement-label">Safaricom M-Pesa ${this.escapeHtml(data.tenant.darajaShortcodeType || 'PAYBILL')}:</span>
              <p class="settlement-value">
                Shortcode: <strong>${this.escapeHtml(data.tenant.darajaShortcode)}</strong> &bull; ${isInvoice ? 'Account:' : 'Reference:'} <strong>${this.escapeHtml(data.documentNumber)}</strong>
              </p>
            </div>
          ` : ''}
        </div>
      </div>
    ` : '';

    const cleanNotes = this.cleanText(data.notes);
    const cleanTerms = this.cleanText(data.terms);
    const hasNotes = df.showNotes !== false && cleanNotes;
    const hasTerms = df.showTerms !== false && cleanTerms;
    const notesHtml = (hasNotes || hasTerms) ? `
      <div class="invoice-notes-terms ${data.type}-notes-terms">
        ${hasNotes ? `<p class="mb-1" style="white-space: pre-line;"><strong>${isInvoice ? 'Notes:' : 'Scope Notes:'}</strong> ${this.escapeHtml(cleanNotes)}</p>` : ''}
        ${hasTerms ? `<p style="white-space: pre-line;"><strong>${isInvoice ? 'Terms:' : 'Quotation Terms &amp; Validity:'}</strong> ${this.escapeHtml(cleanTerms)}</p>` : ''}
      </div>
    ` : '';

    const etimsHtml = (isInvoice && df.showEtimsQr !== false) ? `
      <div class="invoice-etims-banner">
        <div class="invoice-etims-info">
          <div class="invoice-etims-title">KRA eTIMS Verification</div>
          <div class="invoice-etims-hash">Hash: ${this.escapeHtml(data.etimsHash || 'ETIMS-SIGNATURE-NOT-AVAILABLE')}</div>
        </div>
        <div class="invoice-etims-badge">
          <i class="uil uil-qrcode-scan"></i>
          <span class="invoice-etims-badge-text">eTIMS QR</span>
        </div>
      </div>
    ` : '';

    const projectBlockHtml = (df.showProject !== false && (data.project?.name || data.project?.code)) ? `
      <div class="invoice-party-col text-right">
        <h4 class="invoice-party-heading">Project:</h4>
        <p class="font-semibold text-primary">
          ${this.escapeHtml(data.project.name ? `${data.project.name} (${data.project.code})` : data.project.code)}
        </p>
      </div>
    ` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${docTypeLabel} - ${this.escapeHtml(data.documentNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unicons.iconscout.com/release/v4.0.8/css/line.css">
  <style>
    ${this.getEmbeddedCss()}

    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }
    *, *::before, *::after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      box-sizing: border-box !important;
    }
    html, body {
      background: #ffffff !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #0f172a !important;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      width: 100% !important;
    }
    .document-sheet, .quotation-sheet, .invoice-sheet {
      box-shadow: none !important;
      max-width: 100% !important;
      width: 100% !important;
      margin: 0 auto !important;
      box-sizing: border-box !important;
      background: #ffffff !important;
    }

    /* Template Overrides */
    .template-modern .invoice-header-row,
    .template-modern .quotation-header-row {
      border-bottom: 2px solid var(--doc-accent) !important;
    }
    .template-modern .invoice-table th,
    .template-modern .quotation-table th {
      background: #f1f5f9 !important;
      border-bottom: 2px solid var(--doc-accent) !important;
      color: #475569 !important;
    }
    .template-modern .invoice-totals-box,
    .template-modern .quotation-totals-box {
      border-top: 3px solid var(--doc-accent) !important;
    }
    .template-modern .invoice-total-line-grand,
    .template-modern .quotation-total-line-grand {
      color: var(--doc-accent) !important;
    }

    .template-corporate {
      border: 1px solid #cbd5e1 !important;
      border-radius: 8px !important;
      padding: 0 !important;
      overflow: hidden !important;
    }
    .template-corporate .invoice-header-row,
    .template-corporate .quotation-header-row {
      background: var(--doc-accent) !important;
      color: #ffffff !important;
      padding: 24px 28px !important;
      margin-bottom: 20px !important;
      border-bottom: none !important;
    }
    .template-corporate .invoice-brand-block h2,
    .template-corporate .invoice-meta-block h3,
    .template-corporate .quotation-brand-block h2,
    .template-corporate .quotation-meta-block h3 {
      color: #ffffff !important;
    }
    .template-corporate .invoice-brand-block p,
    .template-corporate .invoice-meta-block p,
    .template-corporate .quotation-brand-block p,
    .template-corporate .quotation-meta-block p {
      color: rgba(255, 255, 255, 0.88) !important;
    }
    .template-corporate .invoice-parties-grid,
    .template-corporate .quotation-parties-grid,
    .template-corporate .invoice-table-wrapper,
    .template-corporate .quotation-table-wrapper,
    .template-corporate .invoice-totals-wrapper,
    .template-corporate .quotation-totals-wrapper,
    .template-corporate .invoice-etims-banner,
    .template-corporate .invoice-notes-terms,
    .template-corporate .quotation-notes-terms,
    .template-corporate .invoice-settlement-card {
      padding-left: 28px !important;
      padding-right: 28px !important;
    }
    .template-corporate .invoice-table th,
    .template-corporate .quotation-table th {
      background: var(--doc-accent) !important;
      color: #ffffff !important;
    }
    .template-corporate .invoice-totals-box,
    .template-corporate .quotation-totals-box {
      background: #f8fafc !important;
      border-left: 4px solid var(--doc-accent) !important;
    }

    .template-classic {
      border: 4px double var(--doc-accent) !important;
      border-radius: 0 !important;
      padding: 24px 28px !important;
    }
    .template-classic .invoice-header-row,
    .template-classic .quotation-header-row {
      border-bottom: 1.5px solid var(--doc-accent) !important;
      padding-bottom: 16px !important;
      margin-bottom: 20px !important;
    }
    .template-classic .invoice-brand-block h2,
    .template-classic .quotation-brand-block h2 {
      font-family: Georgia, 'Times New Roman', serif !important;
      letter-spacing: 0.04em !important;
      color: var(--doc-accent) !important;
      font-size: 20px !important;
    }
    .template-classic .invoice-meta-block h3,
    .template-classic .quotation-meta-block h3 {
      font-family: Georgia, 'Times New Roman', serif !important;
      font-size: 18px !important;
    }
    .template-classic .invoice-party-col,
    .template-classic .quotation-party-col {
      border: 1px solid #e2e8f0 !important;
      padding: 14px 18px !important;
      background: #f8fafc !important;
      border-radius: 4px !important;
    }
    .template-classic .invoice-party-name,
    .template-classic .quotation-party-name {
      font-family: Georgia, 'Times New Roman', serif !important;
    }
    .template-classic .invoice-table,
    .template-classic .quotation-table {
      border: 1px solid #e2e8f0 !important;
    }
    .template-classic .invoice-table th,
    .template-classic .quotation-table th {
      border: 1px solid #e2e8f0 !important;
      background: #f1f5f9 !important;
      color: #1e293b !important;
      font-family: Georgia, 'Times New Roman', serif !important;
    }
    .template-classic .invoice-table td,
    .template-classic .quotation-table td {
      border: 1px solid #e2e8f0 !important;
    }
    .template-classic .invoice-total-line-grand,
    .template-classic .quotation-total-line-grand {
      border-bottom: 3px double var(--doc-accent) !important;
      color: var(--doc-accent) !important;
      font-family: Georgia, 'Times New Roman', serif !important;
    }

    .template-creative {
      border-left: 10px solid var(--doc-accent) !important;
      border-radius: 12px !important;
      padding: 24px 28px !important;
    }
    .template-creative .invoice-brand-block h2,
    .template-creative .quotation-brand-block h2 {
      color: var(--doc-accent) !important;
    }
    .template-creative .invoice-table th,
    .template-creative .quotation-table th {
      background: rgba(232, 101, 10, 0.08) !important;
      color: var(--doc-accent) !important;
      border-bottom: 2px solid var(--doc-accent) !important;
    }
    .template-creative .invoice-totals-box,
    .template-creative .quotation-totals-box {
      border: 2px solid var(--doc-accent) !important;
      border-radius: 8px !important;
    }

    .template-executive {
      border: 2px solid var(--doc-accent) !important;
      border-radius: 12px !important;
      outline: 1px solid #cbd5e1 !important;
      outline-offset: -6px !important;
      padding: 24px 28px !important;
    }
    .template-executive .invoice-brand-block h2,
    .template-executive .quotation-brand-block h2 {
      font-family: Georgia, 'Times New Roman', serif !important;
      letter-spacing: 0.06em !important;
      color: var(--doc-accent) !important;
      text-transform: uppercase !important;
    }
    .template-executive .invoice-table th,
    .template-executive .quotation-table th {
      background: #1e293b !important;
      color: #f8fafc !important;
      font-family: Georgia, 'Times New Roman', serif !important;
    }
    .template-executive .invoice-totals-box,
    .template-executive .quotation-totals-box {
      border: 2px solid var(--doc-accent) !important;
    }

    .template-compact {
      border: 1px solid #e2e8f0 !important;
      padding: 16px 20px !important;
      font-family: 'JetBrains Mono', Consolas, monospace !important;
      font-size: 11px !important;
    }
    .template-compact .invoice-table th,
    .template-compact .quotation-table th,
    .template-compact .invoice-table td,
    .template-compact .quotation-table td {
      border: 1px solid #e2e8f0 !important;
      padding: 6px 8px !important;
      font-size: 11px !important;
    }

    .template-minimal {
      border: none !important;
      box-shadow: none !important;
      padding: 16px 20px !important;
    }
    .template-minimal .invoice-table th,
    .template-minimal .quotation-table th {
      background: transparent !important;
      border-bottom: 2px solid #0f172a !important;
      color: #0f172a !important;
    }

    .template-bold {
      border: 1px solid #e2e8f0 !important;
      border-radius: 12px !important;
      overflow: hidden !important;
      padding: 0 !important;
    }
    .template-bold .invoice-header-row,
    .template-bold .quotation-header-row {
      background: var(--doc-accent) !important;
      color: #ffffff !important;
      padding: 24px 28px !important;
    }
    .template-bold .invoice-brand-block h2,
    .template-bold .invoice-brand-block p,
    .template-bold .invoice-meta-block h3,
    .template-bold .invoice-meta-block p,
    .template-bold .quotation-brand-block h2,
    .template-bold .quotation-brand-block p,
    .template-bold .quotation-meta-block h3,
    .template-bold .quotation-meta-block p {
      color: #ffffff !important;
    }
    .template-bold .invoice-parties-grid,
    .template-bold .quotation-parties-grid,
    .template-bold .invoice-table-wrapper,
    .template-bold .quotation-table-wrapper,
    .template-bold .invoice-totals-wrapper,
    .template-bold .quotation-totals-wrapper,
    .template-bold .invoice-etims-banner,
    .template-bold .invoice-notes-terms,
    .template-bold .quotation-notes-terms,
    .template-bold .invoice-settlement-card {
      padding-left: 28px !important;
      padding-right: 28px !important;
    }

    .invoice-header-row, .quotation-header-row {
      display: flex !important;
      justify-content: space-between !important;
      align-items: flex-start !important;
      gap: 20px !important;
    }
    .invoice-brand-block, .quotation-brand-block {
      flex: 1 1 auto !important;
    }
    .invoice-meta-block, .quotation-meta-block {
      flex: 0 0 auto !important;
      text-align: right !important;
      min-width: 200px !important;
    }
    .invoice-parties-grid, .quotation-parties-grid {
      display: flex !important;
      justify-content: space-between !important;
      gap: 24px !important;
      margin-bottom: 24px !important;
    }
    .invoice-party-col, .quotation-party-col {
      flex: 1 !important;
    }
    .invoice-table-wrapper, .quotation-table-wrapper {
      width: 100% !important;
      margin-bottom: 24px !important;
    }
    .invoice-table, .quotation-table {
      width: 100% !important;
      border-collapse: collapse !important;
    }
    .invoice-totals-wrapper, .quotation-totals-wrapper {
      display: flex !important;
      justify-content: flex-end !important;
      margin: 20px 0 !important;
    }
    .invoice-totals-box, .quotation-totals-box {
      min-width: 350px !important;
      max-width: 420px !important;
      background: #f8fafc !important;
      border-radius: 8px !important;
      padding: 16px 20px !important;
      border: 1px solid #e2e8f0 !important;
    }
    .invoice-total-line, .quotation-total-line {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 4px 0 !important;
      font-size: 13px !important;
    }
  </style>
</head>
<body>
  <div class="${data.type}-sheet document-sheet template-${template}" style="--doc-accent: ${primaryColor};">
    
    <!-- Header Row -->
    <div class="invoice-header-row ${data.type}-header-row">
      <div class="invoice-brand-block ${data.type}-brand-block">
        ${logoHtml}
        <h2>${tenantName}</h2>
        <div>
          ${df.showTenantAddress !== false ? `<p>${this.escapeHtml(this.cleanText(data.tenant.address || (data.tenant.city ? data.tenant.city + ', Kenya' : 'Nairobi, Kenya')))}</p>` : ''}
          ${df.showTenantEmail !== false && data.tenant.email ? `<p>Email: ${this.escapeHtml(data.tenant.email)}</p>` : ''}
          ${df.showTenantPhone !== false && data.tenant.phone ? `<p>Phone: ${this.escapeHtml(data.tenant.phone)}</p>` : ''}
          ${df.showTenantKraPin !== false ? `<p><strong>KRA PIN:</strong> ${this.escapeHtml(data.tenant.kraPin || 'P000000000X')}</p>` : ''}
        </div>
      </div>
      <div class="invoice-meta-block ${data.type}-meta-block">
        <div style="margin-bottom: 8px;">${statusBadge}</div>
        <h3>${this.escapeHtml(data.documentNumber)}</h3>
        <p>Issue Date: ${this.formatDate(data.issueDate)}</p>
        ${df.showPaymentTerms !== false && data.dueDateOrValidUntil ? `<p>${data.dueDateLabel}: ${this.formatDate(data.dueDateOrValidUntil)}</p>` : ''}
      </div>
    </div>

    <!-- Client / Bill To & Project Grid -->
    <div class="invoice-parties-grid ${data.type}-parties-grid">
      <div class="invoice-party-col ${data.type}-party-col">
        <h4 class="invoice-party-heading">${clientHeading}</h4>
        <h3 class="invoice-party-name">${clientName}</h3>
        <div class="invoice-party-details">
          ${df.showClientAddress !== false && data.client.address ? `<p>${this.escapeHtml(this.cleanText(data.client.address))}</p>` : ''}
          ${df.showClientAddress !== false && data.client.city ? `<p>${this.escapeHtml(this.cleanText(data.client.city))}, Kenya</p>` : ''}
          ${df.showClientEmail !== false && data.client.email ? `<p>Email: ${this.escapeHtml(data.client.email)}</p>` : ''}
          ${df.showClientPhone !== false && data.client.phone ? `<p>Phone: ${this.escapeHtml(data.client.phone)}</p>` : ''}
          ${df.showClientKraPin !== false && data.client.kraPin ? `<p><strong>${isInvoice ? 'Client KRA PIN:' : 'PIN:'}</strong> ${this.escapeHtml(data.client.kraPin)}</p>` : ''}
        </div>
      </div>
      ${projectBlockHtml}
    </div>

    <!-- Items Table -->
    <div class="table-responsive invoice-table-wrapper ${data.type}-table-wrapper mb-6">
      <table class="invoice-table ${data.type}-table">
        <thead>
          ${isInvoice ? `
            <tr>
              <th>Item Description</th>
              <th class="text-center" style="width: 60px;">Qty</th>
              <th class="text-right" style="width: 120px;">Unit Price</th>
              ${(hasVat && df.showTaxBreakdown !== false) ? `<th class="text-right" style="width: 100px;">VAT (16%)</th>` : ''}
              <th class="text-right" style="width: 130px;">Amount</th>
            </tr>
          ` : `
            <tr>
              <th style="width: 35px;">#</th>
              <th>Item &amp; Service Description</th>
              <th class="text-right" style="width: 60px;">Qty</th>
              <th class="text-right" style="width: 120px;">Unit Price</th>
              ${df.showTaxBreakdown !== false ? `<th class="text-right" style="width: 90px;">Tax Rate</th>` : ''}
              <th class="text-right" style="width: 130px;">Total (KES)</th>
            </tr>
          `}
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>
    </div>

    <!-- Totals Section -->
    <div class="invoice-totals-wrapper ${data.type}-totals-wrapper">
      <div class="invoice-totals-box ${data.type}-totals-box">
        <div class="invoice-total-line">
          <span>Subtotal (Net):</span>
          <span>${formatKES(parseFloat(String(data.subtotal)) || 0)}</span>
        </div>
        ${(hasVat && df.showTaxBreakdown !== false) ? `
          <div class="invoice-total-line">
            <span>VAT (16% Standard):</span>
            <span>${formatKES(parseFloat(String(data.taxAmount)) || 0)}</span>
          </div>
        ` : (isInvoice && df.showTaxBreakdown !== false ? `
          <div class="invoice-total-line text-muted">
            <span>VAT (0% Exempt):</span>
            <span>KES 0.00</span>
          </div>
        ` : '')}
        ${(df.showDiscount !== false && parseFloat(String(data.discountAmount || 0)) > 0) ? `
          <div class="invoice-total-line">
            <span>${isInvoice ? 'Discount:' : 'Special Discount:'}</span>
            <span>- ${formatKES(parseFloat(String(data.discountAmount)) || 0)}</span>
          </div>
        ` : ''}
        <div class="invoice-total-line invoice-total-line-grand ${data.type}-total-line-grand">
          <span>${totalHeading}</span>
          <span>${formatKES(parseFloat(String(data.totalAmount)) || 0)}</span>
        </div>
        ${isInvoice ? `
          <div class="invoice-total-line text-success font-medium">
            <span>Amount Paid:</span>
            <span>${formatKES(parseFloat(String(data.amountPaid || 0)) || 0)}</span>
          </div>
          <div class="invoice-total-line invoice-total-line-balance">
            <span>Balance Due:</span>
            <span>${formatKES(parseFloat(String(data.balanceDue ?? data.totalAmount)) || 0)}</span>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Settlement Details -->
    ${settlementHtml}

    <!-- eTIMS Verification Banner -->
    ${etimsHtml}

    <!-- Notes & Terms -->
    ${notesHtml}

  </div>
</body>
</html>`;
  }

  /**
   * Primary entrypoint: Stream PDF directly to Express response
   * Renders with headless Chrome/Edge to ensure exact fidelity with web templates,
   * with automatic high-fidelity fallback to native PDFKit generator.
   */
  async generateDocumentPdf(data: DocumentPdfData, res: Response): Promise<void> {
    const filename = `${data.type === 'invoice' ? 'Invoice' : 'Quotation'}-${data.documentNumber}.pdf`;

    // 1. Try Headless Chrome/Edge rendering (100% exact copy of web templates)
    const browser = await this.getBrowser();
    if (browser) {
      try {
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
          const html = await this.generateDocumentHtml(data);
          await page.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(async () => {
            await page.setContent(html, { waitUntil: 'load' });
          });
          await page.evaluateHandle('document.fonts.ready').catch(() => {});
          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
          });

          if (typeof res.setHeader === 'function') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            res.setHeader('Content-Length', pdfBuffer.length);
          }

          if (typeof (res as any).end === 'function') {
            (res as any).end(pdfBuffer);
            return;
          }
        } finally {
          await page.close().catch(() => {});
        }
      } catch (chromeErr: any) {
        pdfLogger.warn('Headless browser PDF rendering failed. Falling back to native PDFKit.', {
          error: chromeErr?.message,
        });
      }
    }

    // 2. High-fidelity Fallback to PDFKit
    await this.generateDocumentPdfWithPdfKit(data, res);
  }

  /**
   * Generate Document PDF as a Buffer (for email attachment & background jobs)
   */
  async generateDocumentPdfBuffer(data: DocumentPdfData): Promise<Buffer> {
    const browser = await this.getBrowser();
    if (browser) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
        const html = await this.generateDocumentHtml(data);
        await page.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(async () => {
          await page.setContent(html, { waitUntil: 'load' });
        });
        await page.evaluateHandle('document.fonts.ready').catch(() => {});
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        return Buffer.from(pdfBytes);
      } finally {
        await page.close().catch(() => {});
      }
    }

    // Fallback: render using PDFKit into buffer
    return new Promise<Buffer>((resolve, reject) => {
      const passThrough = new PassThrough();
      const chunks: Buffer[] = [];
      passThrough.on('data', (c) => chunks.push(c));
      passThrough.on('end', () => resolve(Buffer.concat(chunks)));
      passThrough.on('error', reject);
      this.generateDocumentPdfWithPdfKit(data, passThrough as any).catch(reject);
    });
  }

  /**
   * Generates HTML for official payment receipt
   */
  async generateReceiptHtml(data: ReceiptPdfData): Promise<string> {
    const primaryColor = data.tenant.primaryColor || '#059669';
    const rf = {
      showTenantKraPin: true,
      showBankDetails: true,
      showMpesaRef: true,
      showProject: true,
      showClientPhone: true,
      showClientAddress: true,
      showNotes: true,
      receiptFooterNote: 'Thank you for your business. For any queries, contact accounts.',
      ...(data.receiptFields || {}),
    };

    const logoDataUri = await this.getLogoDataUri(data.tenant.logoUrl);
    let logoHtml = '';
    if (logoDataUri) {
      logoHtml = `<div style="margin-bottom: 12px;">
        <img src="${logoDataUri}" alt="${this.escapeHtml(this.cleanText(data.tenant.name))} Logo" style="max-height: 55px; max-width: 200px; object-fit: contain;">
      </div>`;
    }

    const itemsRows = (data.items || []).map((it, idx) => `
      <tr>
        <td style="width: 35px; text-align: center;">${idx + 1}</td>
        <td><strong>${this.escapeHtml(this.cleanText(it.description))}</strong></td>
        <td style="text-align: right; width: 60px;">${it.quantity}</td>
        <td style="text-align: right; width: 120px;">${formatKES(parseFloat(String(it.unitPrice)) || 0)}</td>
        <td style="text-align: right; width: 130px; font-weight: 700;">${formatKES(parseFloat(String(it.lineTotal)) || 0)}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Payment Receipt - ${this.escapeHtml(data.receiptNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 14mm;
    }
    *, *::before, *::after {
      box-sizing: border-box !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      background: #ffffff !important;
      color: #0f172a !important;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      margin: 0;
      padding: 0;
    }
    .receipt-sheet {
      border: 2px solid ${primaryColor};
      border-radius: 12px;
      padding: 28px 32px;
      background: #ffffff;
      position: relative;
    }
    .receipt-watermark {
      position: absolute;
      right: 32px;
      top: 130px;
      border: 2px dashed #059669;
      border-radius: 8px;
      padding: 8px 18px;
      color: #059669;
      font-weight: 800;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      transform: rotate(-7deg);
      opacity: 0.85;
      background: rgba(209, 250, 229, 0.4);
    }
    .receipt-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid ${primaryColor};
      padding-bottom: 20px;
      margin-bottom: 24px;
      gap: 20px;
    }
    .receipt-brand h2 {
      font-size: 22px;
      font-weight: 800;
      color: ${primaryColor};
      margin: 0 0 6px 0;
    }
    .receipt-brand p {
      margin: 2px 0;
      font-size: 12px;
      color: #475569;
    }
    .receipt-meta {
      text-align: right;
      min-width: 200px;
    }
    .receipt-badge {
      display: inline-block;
      background: #d1fae5;
      color: #065f46;
      font-weight: 700;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .receipt-meta h3 {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .receipt-meta p {
      margin: 2px 0;
      font-size: 12px;
      color: #475569;
    }
    .payment-summary-box {
      background: #f0fdf4;
      border: 1.5px solid #a7f3d0;
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .summary-item {
      flex: 1;
    }
    .summary-item-label {
      font-size: 11px;
      font-weight: 700;
      color: #047857;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .summary-item-val {
      font-size: 14px;
      font-weight: 700;
      color: #064e3b;
      margin-top: 4px;
      word-break: break-all;
    }
    .receipt-parties-grid {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
    }
    .receipt-card {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
    }
    .receipt-card-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 8px;
    }
    .receipt-card-name {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .receipt-card p {
      margin: 2px 0;
      font-size: 12px;
      color: #334155;
    }
    .receipt-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .receipt-table th {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      padding: 10px 12px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
      letter-spacing: 0.05em;
    }
    .receipt-table td {
      border: 1px solid #e2e8f0;
      padding: 10px 12px;
      font-size: 12px;
      color: #1e293b;
    }
    .receipt-totals-area {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 24px;
    }
    .receipt-totals-box {
      width: 360px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
    }
    .receipt-totals-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: #475569;
      margin-bottom: 8px;
    }
    .receipt-totals-row.grand {
      border-top: 2px solid ${primaryColor};
      padding-top: 8px;
      margin-top: 8px;
      font-size: 16px;
      font-weight: 800;
      color: ${primaryColor};
    }
    .receipt-footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 16px;
      margin-top: 20px;
      font-size: 11px;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="receipt-sheet">
    <div class="receipt-watermark">PAID &bull; VERIFIED</div>

    <!-- Header Row -->
    <div class="receipt-header">
      <div class="receipt-brand">
        ${logoHtml}
        <h2>${this.escapeHtml(this.cleanText(data.tenant.name))}</h2>
        <p>${this.escapeHtml(this.cleanText(data.tenant.address || 'Nairobi, Kenya'))}</p>
        ${data.tenant.email ? `<p>Email: ${this.escapeHtml(data.tenant.email)}</p>` : ''}
        ${data.tenant.phone ? `<p>Phone: ${this.escapeHtml(data.tenant.phone)}</p>` : ''}
        ${rf.showTenantKraPin && data.tenant.kraPin ? `<p><strong>KRA PIN:</strong> ${this.escapeHtml(data.tenant.kraPin)}</p>` : ''}
      </div>
      <div class="receipt-meta">
        <span class="receipt-badge">Official Payment Receipt</span>
        <h3>${this.escapeHtml(data.receiptNumber)}</h3>
        <p>Invoice Ref: <strong>${this.escapeHtml(data.invoiceNumber)}</strong></p>
        <p>Payment Date: ${this.formatDate(data.paymentDate)}</p>
        ${rf.showProject && data.project?.code ? `<p>Project: <strong>${this.escapeHtml(data.project.code)}</strong></p>` : ''}
      </div>
    </div>

    <!-- Payment Transaction Banner -->
    <div class="payment-summary-box">
      <div class="summary-item">
        <div class="summary-item-label">Amount Paid</div>
        <div class="summary-item-val" style="font-size: 18px; color: #047857;">${formatKES(parseFloat(String(data.amountPaid)) || 0)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-item-label">Payment Method</div>
        <div class="summary-item-val">${this.escapeHtml(data.paymentMethod)}</div>
      </div>
      <div class="summary-item">
        <div class="summary-item-label">Transaction Ref</div>
        <div class="summary-item-val">${this.escapeHtml(data.paymentReference)}</div>
      </div>
    </div>

    <!-- Client / Payer Details -->
    <div class="receipt-parties-grid">
      <div class="receipt-card">
        <div class="receipt-card-title">Received From (Client)</div>
        <div class="receipt-card-name">${this.escapeHtml(this.cleanText(data.client.name))}</div>
        ${rf.showClientAddress && data.client.address ? `<p>${this.escapeHtml(this.cleanText(data.client.address))}</p>` : ''}
        ${data.client.email ? `<p>Email: ${this.escapeHtml(data.client.email)}</p>` : ''}
        ${rf.showClientPhone && data.client.phone ? `<p>Phone: ${this.escapeHtml(data.client.phone)}</p>` : ''}
        ${data.client.kraPin ? `<p>PIN: ${this.escapeHtml(data.client.kraPin)}</p>` : ''}
      </div>
      ${rf.showBankDetails && data.tenant.bankDetails ? `
        <div class="receipt-card">
          <div class="receipt-card-title">Settlement Account Verified</div>
          <p><strong>Bank Details:</strong> ${this.escapeHtml(this.cleanText(data.tenant.bankDetails))}</p>
          ${rf.showMpesaRef && data.tenant.darajaShortcode ? `
            <p><strong>M-Pesa Shortcode:</strong> ${this.escapeHtml(data.tenant.darajaShortcode)} (${this.escapeHtml(data.tenant.darajaShortcodeType || 'PAYBILL')})</p>
          ` : ''}
        </div>
      ` : ''}
    </div>

    <!-- Items Table (if any) -->
    ${itemsRows ? `
      <table class="receipt-table">
        <thead>
          <tr>
            <th style="width: 35px;">#</th>
            <th>Service / Retainer Description</th>
            <th style="text-align: right; width: 60px;">Qty</th>
            <th style="text-align: right; width: 120px;">Unit Price</th>
            <th style="text-align: right; width: 130px;">Total (KES)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>
    ` : ''}

    <!-- Totals Area -->
    <div class="receipt-totals-area">
      <div class="receipt-totals-box">
        <div class="receipt-totals-row">
          <span>Invoice Total:</span>
          <span>${formatKES(parseFloat(String(data.totalInvoiceAmount)) || 0)}</span>
        </div>
        <div class="receipt-totals-row grand">
          <span>Amount Settled:</span>
          <span>${formatKES(parseFloat(String(data.amountPaid)) || 0)}</span>
        </div>
        <div class="receipt-totals-row" style="color: #059669; font-weight: 700;">
          <span>Outstanding Balance:</span>
          <span>${formatKES(parseFloat(String(data.balanceDue)) || 0)}</span>
        </div>
      </div>
    </div>

    <!-- Footer Note -->
    <div class="receipt-footer">
      <p style="margin: 0 0 4px 0; font-weight: 600;">${this.escapeHtml(rf.receiptFooterNote || 'Thank you for your business!')}</p>
      <p style="margin: 0;">This document serves as an official electronic receipt. Verified &amp; generated on ${this.formatDate(data.paymentDate)}.</p>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Generates Payment Receipt PDF and optionally streams to response or returns buffer
   */
  async generateReceiptPdf(data: ReceiptPdfData, res?: Response): Promise<Buffer> {
    const filename = `Receipt-${data.receiptNumber}.pdf`;
    const browser = await this.getBrowser();
    let pdfBuffer: Buffer;

    if (browser) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
        const html = await this.generateReceiptHtml(data);
        await page.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(async () => {
          await page.setContent(html, { waitUntil: 'load' });
        });
        await page.evaluateHandle('document.fonts.ready').catch(() => {});
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        pdfBuffer = Buffer.from(pdfBytes);
      } finally {
        await page.close().catch(() => {});
      }
    } else {
      // PDFKit fallback for receipt
      pdfBuffer = await new Promise<Buffer>((resolve) => {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        doc.fontSize(20).fillColor('#059669').text(this.cleanText(data.tenant.name));
        doc.fontSize(10).fillColor('#64748B').text(`OFFICIAL RECEIPT: ${data.receiptNumber}`);
        doc.text(`Invoice: ${data.invoiceNumber}`);
        doc.text(`Payment Date: ${this.formatDate(data.paymentDate)}`);
        doc.text(`Payment Method: ${data.paymentMethod}`);
        doc.text(`Reference: ${data.paymentReference}`);
        doc.moveDown();
        doc.fontSize(14).fillColor('#059669').text(`Amount Paid: ${formatKES(parseFloat(String(data.amountPaid)) || 0)}`);
        doc.end();
      });
    }

    if (res && typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      (res as any).end(pdfBuffer);
    }

    return pdfBuffer;
  }

  /**
   * PDFKit fallback generator - High-fidelity implementation matching all 8 templates
   */
  private async generateDocumentPdfWithPdfKit(data: DocumentPdfData, res: Response): Promise<void> {
    const template = (data.template || 'modern').toLowerCase();
    const primaryColor = data.customColor || data.tenant.primaryColor || '#4F46E5';
    const darkSlate = '#0F172A';
    const mutedGray = '#64748B';
    const borderGray = '#E2E8F0';
    const lightBg = '#F8FAFC';
    const isInvoice = data.type === 'invoice';

    const df: TenantDisplayFields = {
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
      ...(data.displayFields || {}),
    };

    let fontRegular = 'Helvetica';
    let fontBold = 'Helvetica-Bold';
    let fontItalic = 'Helvetica-Oblique';

    if (template === 'classic' || template === 'executive') {
      fontRegular = 'Times-Roman';
      fontBold = 'Times-Bold';
      fontItalic = 'Times-Italic';
    } else if (template === 'compact') {
      fontRegular = 'Courier';
      fontBold = 'Courier-Bold';
      fontItalic = 'Courier-Oblique';
    }

    const doc = new PDFDocument({
      size: 'A4',
      margin: template === 'compact' ? 30 : 36,
      info: {
        Title: `${data.type === 'invoice' ? 'Invoice' : 'Quotation'} ${data.documentNumber}`,
        Author: this.cleanText(data.tenant.name),
        Subject: this.cleanText(data.title || (data.type === 'invoice' ? 'Tax Invoice' : 'Quotation')),
      },
    });

    const filename = `${data.type === 'invoice' ? 'Invoice' : 'Quotation'}-${data.documentNumber}.pdf`;
    if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    doc.pipe(res);

    const logoBuffer = await this.getLogoBuffer(data.tenant.logoUrl);
    const pageWidth = 595.28;
    const pageHeight = 841.89;

    let leftX = 36;
    let contentWidth = 523;
    let rightColX = 360;
    let topY = 36;

    // Apply template border/frame decorations
    if (template === 'corporate') {
      doc.rect(0, 0, pageWidth, 90).fill(primaryColor);
      topY = 22;
      leftX = 36;
      contentWidth = 523;
    } else if (template === 'bold') {
      doc.rect(0, 0, pageWidth, 95).fill(primaryColor);
      topY = 24;
      leftX = 36;
      contentWidth = 523;
    } else if (template === 'creative') {
      doc.rect(0, 0, 12, pageHeight).fill(primaryColor);
      leftX = 46;
      contentWidth = 513;
      rightColX = 370;
    } else if (template === 'classic') {
      doc.rect(18, 18, pageWidth - 36, pageHeight - 36).strokeColor(primaryColor).lineWidth(2).stroke();
      doc.rect(21, 21, pageWidth - 42, pageHeight - 42).strokeColor(primaryColor).lineWidth(0.75).stroke();
      leftX = 38;
      contentWidth = 519;
      rightColX = 360;
    } else if (template === 'executive') {
      doc.roundedRect(18, 18, pageWidth - 36, pageHeight - 36, 8).strokeColor(primaryColor).lineWidth(2).stroke();
      doc.roundedRect(22, 22, pageWidth - 44, pageHeight - 44, 6).strokeColor(borderGray).lineWidth(0.75).stroke();
      leftX = 40;
      contentWidth = 515;
      rightColX = 360;
    }

    // Render Brand & Logo
    let brandTextX = leftX;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, leftX, topY, { fit: [110, 48] });
        brandTextX = leftX + 120;
      } catch {}
    }

    const isHeaderWhite = template === 'corporate' || template === 'bold';
    const headerTextColor = isHeaderWhite ? '#FFFFFF' : darkSlate;
    const headerMutedColor = isHeaderWhite ? '#F1F5F9' : mutedGray;
    const brandWidth = rightColX - brandTextX - 15;

    doc.fillColor(headerTextColor).fontSize(16).font(fontBold).text(this.cleanText(data.tenant.name), brandTextX, topY, { width: brandWidth });
    let vendorY = doc.y + 3;

    doc.fontSize(8.5).font(fontRegular).fillColor(headerMutedColor);
    if (df.showTenantAddress !== false) {
      const tenantAddr = this.cleanText(data.tenant.address || (data.tenant.city ? data.tenant.city + ', Kenya' : 'Nairobi, Kenya'));
      doc.text(tenantAddr, brandTextX, vendorY, { width: brandWidth });
      vendorY = doc.y + 2;
    }
    if (df.showTenantEmail !== false && data.tenant.email) {
      doc.text(`Email: ${data.tenant.email}`, brandTextX, vendorY, { width: brandWidth });
      vendorY = doc.y + 2;
    }
    if (df.showTenantPhone !== false && data.tenant.phone) {
      doc.text(`Phone: ${data.tenant.phone}`, brandTextX, vendorY, { width: brandWidth });
      vendorY = doc.y + 2;
    }
    if (df.showTenantKraPin !== false) {
      const tenantPin = data.tenant.kraPin || 'P000000000X';
      doc.text(`KRA PIN: ${tenantPin}`, brandTextX, vendorY, { width: brandWidth });
      vendorY = doc.y + 2;
    }

    // Render Status Badge & Meta Block (matching preview top-right)
    const metaColWidth = leftX + contentWidth - rightColX;
    let metaCurrentY = topY;

    const isPaid = data.status === 'PAID';
    const badgeText = (isInvoice ? (isPaid ? 'PAID' : 'UNPAID') : data.status).toUpperCase();
    const badgeW = Math.max(65, doc.widthOfString(badgeText) + 26);
    const badgeH = 17;
    const badgeX = leftX + contentWidth - badgeW;

    let badgeBg = '#FEE2E2';
    let badgeBorder = '#FECACA';
    let badgeColor = '#991B1B';
    let dotColor = '#EF4444';

    if (isPaid || data.status === 'CONVERTED') {
      badgeBg = '#D1FAE5';
      badgeBorder = '#A7F3D0';
      badgeColor = '#065F46';
      dotColor = '#10B981';
    } else if (!isInvoice && data.status === 'SENT') {
      badgeBg = '#DBEAFE';
      badgeBorder = '#BFDBFE';
      badgeColor = '#1E40AF';
      dotColor = '#3B82F6';
    }

    if (isHeaderWhite) {
      badgeBg = '#FFFFFF';
      badgeBorder = isPaid ? '#10B981' : '#EF4444';
      badgeColor = isPaid ? '#065F46' : '#991B1B';
      dotColor = isPaid ? '#10B981' : '#EF4444';
    }

    doc.roundedRect(badgeX, metaCurrentY, badgeW, badgeH, 6).fill(badgeBg).stroke(badgeBorder);
    doc.circle(badgeX + 8, metaCurrentY + 8.5, 3).fill(dotColor);
    doc.fontSize(8.5).font(fontBold).fillColor(badgeColor).text(badgeText, badgeX + 15, metaCurrentY + 4.5, { width: badgeW - 18, align: 'center' });
    metaCurrentY += 23;

    doc.fillColor(headerTextColor).fontSize(14).font(fontBold).text(data.documentNumber, rightColX, metaCurrentY, { width: metaColWidth, align: 'right' });
    metaCurrentY = doc.y + 3;

    doc.fontSize(8.5).font(fontRegular).fillColor(headerMutedColor);
    doc.text(`Issue Date: ${this.formatDate(data.issueDate)}`, rightColX, metaCurrentY, { width: metaColWidth, align: 'right' });
    metaCurrentY = doc.y + 2;

    if (df.showPaymentTerms !== false && data.dueDateOrValidUntil) {
      doc.text(`${data.dueDateLabel}: ${this.formatDate(data.dueDateOrValidUntil)}`, rightColX, metaCurrentY, { width: metaColWidth, align: 'right' });
      metaCurrentY = doc.y + 2;
    }

    const headerBottomY = Math.max(vendorY, metaCurrentY, topY + 70);
    let partiesTopY = (template === 'corporate' || template === 'bold') ? 115 : headerBottomY + 16;

    // Header divider rule for modern/classic
    if (template === 'modern') {
      doc.moveTo(leftX, partiesTopY - 8).lineTo(leftX + contentWidth, partiesTopY - 8).strokeColor(primaryColor).lineWidth(1.5).stroke();
    } else if (template === 'classic') {
      doc.moveTo(leftX, partiesTopY - 8).lineTo(leftX + contentWidth, partiesTopY - 8).strokeColor(primaryColor).lineWidth(1).stroke();
    }

    // Client Parties Row + Project on Right (matching preview layout)
    const clientHeading = isInvoice ? 'BILLED TO:' : 'ESTIMATE PREPARED FOR:';

    doc.fillColor(darkSlate).fontSize(8.5).font(fontBold).text(clientHeading, leftX, partiesTopY);
    let clientY = doc.y + 3;
    doc.fontSize(10.5).font(fontBold).fillColor(darkSlate).text(this.cleanText(data.client.name), leftX, clientY);
    clientY = doc.y + 2;

    doc.fontSize(8.5).font(fontRegular).fillColor(mutedGray);
    if (df.showClientAddress !== false && data.client.address) {
      const clientAddr = this.cleanText(data.client.address) + (data.client.city ? ', ' + this.cleanText(data.client.city) : '');
      doc.text(clientAddr, leftX, clientY, { width: 300 });
      clientY = doc.y + 2;
    }
    if (df.showClientEmail !== false && data.client.email) {
      doc.text(`Email: ${data.client.email}`, leftX, clientY);
      clientY = doc.y + 2;
    }
    if (df.showClientPhone !== false && data.client.phone) {
      doc.text(`Phone: ${data.client.phone}`, leftX, clientY);
      clientY = doc.y + 2;
    }
    if (df.showClientKraPin !== false && data.client.kraPin) {
      doc.text(`Client KRA PIN: ${data.client.kraPin}`, leftX, clientY);
      clientY = doc.y + 2;
    }

    // Project block positioned on the right (matching preview)
    if (df.showProject !== false && (data.project?.name || data.project?.code)) {
      doc.fillColor(darkSlate).fontSize(8.5).font(fontBold).text('PROJECT:', rightColX, partiesTopY, { width: metaColWidth, align: 'right' });
      const projText = data.project.name ? `${data.project.name} (${data.project.code})` : data.project.code;
      doc.fontSize(9.5).font(fontBold).fillColor(primaryColor).text(projText, rightColX, partiesTopY + 14, { width: metaColWidth, align: 'right' });
    }

    const tableTopY = Math.max(clientY, partiesTopY + 48) + 14;

    // Items Table Setup (matching preview columns)
    const hasVatCol = df.showTaxBreakdown !== false && (isInvoice ? (data.includeVat !== false && parseFloat(String(data.taxAmount || 0)) > 0) : true);
    let descW = 230;
    let qtyW = 35;
    let priceW = 80;
    let vatW = hasVatCol ? 75 : 0;
    let totalW = contentWidth - (descW + qtyW + priceW + vatW);

    let descX = leftX;
    let qtyX = descX + descW;
    let priceX = qtyX + qtyW;
    let vatX = priceX + priceW;
    let totalX = vatX + vatW;

    // Table Header Styling per Template
    if (template === 'corporate') {
      doc.rect(leftX, tableTopY, contentWidth, 22).fill(primaryColor);
      doc.fillColor('#FFFFFF').fontSize(8.5).font(fontBold);
    } else if (template === 'executive') {
      doc.rect(leftX, tableTopY, contentWidth, 22).fill('#1E293B');
      doc.fillColor('#F8FAFC').fontSize(8.5).font(fontBold);
    } else if (template === 'classic') {
      doc.rect(leftX, tableTopY, contentWidth, 22).fill('#F1F5F9').stroke(borderGray);
      doc.fillColor(darkSlate).fontSize(8.5).font(fontBold);
    } else if (template === 'creative' || template === 'bold') {
      doc.rect(leftX, tableTopY, contentWidth, 22).fill('#F8FAFC');
      doc.moveTo(leftX, tableTopY + 22).lineTo(leftX + contentWidth, tableTopY + 22).strokeColor(primaryColor).lineWidth(2).stroke();
      doc.fillColor(primaryColor).fontSize(8.5).font(fontBold);
    } else if (template === 'minimal') {
      doc.moveTo(leftX, tableTopY + 22).lineTo(leftX + contentWidth, tableTopY + 22).strokeColor('#0F172A').lineWidth(1.5).stroke();
      doc.fillColor('#0F172A').fontSize(8.5).font(fontBold);
    } else {
      // Modern template (matching preview): clean light gray header with bottom accent rule
      doc.rect(leftX, tableTopY, contentWidth, 22).fill('#F1F5F9');
      doc.moveTo(leftX, tableTopY + 22).lineTo(leftX + contentWidth, tableTopY + 22).strokeColor(primaryColor).lineWidth(1.5).stroke();
      doc.fillColor('#475569').fontSize(8.5).font(fontBold);
    }

    if (isInvoice) {
      doc.text('Item Description', descX + 8, tableTopY + 6, { width: descW - 12 });
      doc.text('Qty', qtyX, tableTopY + 6, { width: qtyW, align: 'center' });
      doc.text('Unit Price', priceX, tableTopY + 6, { width: priceW - 4, align: 'right' });
      if (hasVatCol) {
        doc.text('VAT (16%)', vatX, tableTopY + 6, { width: vatW - 4, align: 'right' });
      }
      doc.text('Amount', totalX, tableTopY + 6, { width: totalW - 8, align: 'right' });
    } else {
      doc.text('Item & Service Description', descX + 8, tableTopY + 6, { width: descW - 12 });
      doc.text('Qty', qtyX, tableTopY + 6, { width: qtyW, align: 'center' });
      doc.text('Unit Price', priceX, tableTopY + 6, { width: priceW - 4, align: 'right' });
      if (hasVatCol) {
        doc.text('Tax Rate', vatX, tableTopY + 6, { width: vatW - 4, align: 'right' });
      }
      doc.text('Total (KES)', totalX, tableTopY + 6, { width: totalW - 8, align: 'right' });
    }

    // Render Table Rows
    let currentY = tableTopY + 22;
    data.items.forEach((item, index) => {
      const isAlt = index % 2 === 1;
      if (isAlt && template !== 'minimal') {
        doc.rect(leftX, currentY, contentWidth, 22).fill('#FAFAFA');
      }
      doc.moveTo(leftX, currentY + 22).lineTo(leftX + contentWidth, currentY + 22).strokeColor(borderGray).lineWidth(0.5).stroke();

      if (template === 'compact' || template === 'classic') {
        doc.rect(leftX, currentY, contentWidth, 22).stroke(borderGray);
      }

      const qty = parseFloat(String(item.quantity)) || 1;
      const price = parseFloat(String(item.unitPrice)) || 0;
      const tax = (item.lineTax !== undefined && item.lineTax !== null)
        ? parseFloat(String(item.lineTax))
        : (hasVatCol ? qty * price * 0.16 : 0);
      const total = (item.lineTotal !== undefined && item.lineTotal !== null)
        ? parseFloat(String(item.lineTotal))
        : qty * price * (hasVatCol ? 1.16 : 1);

      doc.fillColor(darkSlate).fontSize(8.5).font(fontRegular);
      doc.text(this.cleanText(item.description), descX + 8, currentY + 6, { width: descW - 12, ellipsis: true });
      doc.text(String(qty), qtyX, currentY + 6, { width: qtyW, align: 'center' });
      doc.text(formatKES(price), priceX, currentY + 6, { width: priceW - 4, align: 'right' });
      if (hasVatCol) {
        if (isInvoice) {
          doc.text(formatKES(tax), vatX, currentY + 6, { width: vatW - 4, align: 'right' });
        } else {
          doc.text('16% VAT', vatX, currentY + 6, { width: vatW - 4, align: 'right' });
        }
      }
      doc.font(fontBold).text(formatKES(total), totalX, currentY + 6, { width: totalW - 8, align: 'right' });
      currentY += 22;
    });

    // Totals Box (matching preview with Amount Paid & Balance Due)
    const totalsBoxW = 215;
    const totalsBoxX = leftX + contentWidth - totalsBoxW;
    let totalsBoxY = currentY + 14;

    const discountNum = parseFloat(String(data.discountAmount || 0));
    const hasDiscount = df.showDiscount !== false && discountNum > 0;
    const totalsBoxHeight = (isInvoice ? 105 : 75) + (hasVatCol ? 16 : 0) + (hasDiscount ? 16 : 0);

    doc.rect(totalsBoxX, totalsBoxY, totalsBoxW, totalsBoxHeight).fill(lightBg).stroke(borderGray);

    if (template === 'modern') {
      doc.moveTo(totalsBoxX, totalsBoxY).lineTo(totalsBoxX + totalsBoxW, totalsBoxY).strokeColor(primaryColor).lineWidth(3).stroke();
    } else if (template === 'corporate') {
      doc.rect(totalsBoxX, totalsBoxY, 4, totalsBoxHeight).fill(primaryColor);
    } else if (template === 'creative') {
      doc.rect(totalsBoxX, totalsBoxY, totalsBoxW, totalsBoxHeight).strokeColor(primaryColor).lineWidth(2).stroke();
    }

    let tRowY = totalsBoxY + 8;
    doc.fontSize(8.5).font(fontRegular).fillColor(mutedGray);
    doc.text('Subtotal (Net):', totalsBoxX + 12, tRowY);
    doc.font(fontBold).fillColor(darkSlate).text(formatKES(parseFloat(String(data.subtotal)) || 0), totalsBoxX + 90, tRowY, { width: totalsBoxW - 102, align: 'right' });
    tRowY += 16;

    if (hasVatCol) {
      doc.font(fontRegular).fillColor(mutedGray).text(isInvoice ? 'VAT (16% Standard):' : 'VAT (16% Standard Rate):', totalsBoxX + 12, tRowY);
      doc.font(fontBold).fillColor(darkSlate).text(formatKES(parseFloat(String(data.taxAmount)) || 0), totalsBoxX + 90, tRowY, { width: totalsBoxW - 102, align: 'right' });
      tRowY += 16;
    } else if (isInvoice && df.showTaxBreakdown !== false) {
      doc.font(fontRegular).fillColor(mutedGray).text('VAT (0% Exempt):', totalsBoxX + 12, tRowY);
      doc.font(fontBold).fillColor(darkSlate).text('KES 0.00', totalsBoxX + 90, tRowY, { width: totalsBoxW - 102, align: 'right' });
      tRowY += 16;
    }

    if (hasDiscount) {
      doc.font(fontRegular).fillColor(mutedGray).text(isInvoice ? 'Discount:' : 'Special Discount:', totalsBoxX + 12, tRowY);
      doc.font(fontBold).fillColor(darkSlate).text(`- ${formatKES(discountNum)}`, totalsBoxX + 90, tRowY, { width: totalsBoxW - 102, align: 'right' });
      tRowY += 16;
    }

    doc.moveTo(totalsBoxX + 12, tRowY).lineTo(totalsBoxX + totalsBoxW - 12, tRowY).strokeColor(borderGray).lineWidth(1).stroke();
    tRowY += 4;

    doc.fontSize(9.5).font(fontBold).fillColor(primaryColor);
    doc.text(isInvoice ? 'Grand Total:' : 'Estimated Total:', totalsBoxX + 12, tRowY);
    doc.text(formatKES(parseFloat(String(data.totalAmount)) || 0), totalsBoxX + 90, tRowY, { width: totalsBoxW - 102, align: 'right' });
    tRowY += 18;

    if (isInvoice) {
      const paidNum = parseFloat(String(data.amountPaid || 0));
      const balNum = parseFloat(String(data.balanceDue ?? data.totalAmount));

      doc.fontSize(8.5).font(fontBold).fillColor('#059669');
      doc.text('Amount Paid:', totalsBoxX + 12, tRowY);
      doc.text(formatKES(paidNum), totalsBoxX + 90, tRowY, { width: totalsBoxW - 102, align: 'right' });
      tRowY += 16;

      doc.moveTo(totalsBoxX + 12, tRowY - 2).lineTo(totalsBoxX + totalsBoxW - 12, tRowY - 2).strokeColor(borderGray).lineWidth(1).stroke();

      doc.fontSize(9).font(fontBold).fillColor('#EF4444');
      doc.text('Balance Due:', totalsBoxX + 12, tRowY);
      doc.text(formatKES(balNum), totalsBoxX + 90, tRowY, { width: totalsBoxW - 102, align: 'right' });
    }

    let afterTotalsY = Math.max(totalsBoxY + totalsBoxHeight + 14, currentY + 14);

    // Settlement Card Box (matching preview)
    const hasBank = df.showBankDetails !== false && data.tenant.bankDetails;
    const hasMpesa = df.showMpesaDetails !== false && data.tenant.darajaShortcode;
    if (hasBank || hasMpesa) {
      const settlementBoxW = contentWidth;
      const cleanBank = this.cleanText(data.tenant.bankDetails);
      const settlementBoxH = (hasBank && hasMpesa) ? 48 : 34;

      doc.rect(leftX, afterTotalsY, settlementBoxW, settlementBoxH).fill('#F8FAFC').stroke(borderGray);
      doc.fontSize(8).font(fontBold).fillColor(primaryColor).text('PAYMENT & SETTLEMENT DETAILS', leftX + 12, afterTotalsY + 6);

      let setY = afterTotalsY + 18;
      if (hasBank && cleanBank) {
        doc.fontSize(8).font(fontRegular).fillColor(darkSlate).text(`Bank Settlement Account: ${cleanBank}`, leftX + 12, setY, { width: settlementBoxW - 24 });
        setY += 13;
      }
      if (hasMpesa) {
        const shortcodeType = data.tenant.darajaShortcodeType || 'PAYBILL';
        doc.fontSize(8).font(fontRegular).fillColor(darkSlate).text(`Safaricom M-Pesa ${shortcodeType}: Shortcode: ${data.tenant.darajaShortcode} • ${isInvoice ? 'Account' : 'Reference'}: ${data.documentNumber}`, leftX + 12, setY, { width: settlementBoxW - 24 });
      }

      afterTotalsY += settlementBoxH + 12;
    }

    // eTIMS Banner (for invoices)
    if (isInvoice && df.showEtimsQr !== false) {
      doc.rect(leftX, afterTotalsY, contentWidth, 26).fill('#F1F5F9').stroke(borderGray);
      doc.fontSize(7.5).font(fontBold).fillColor(primaryColor).text('KRA eTIMS VERIFICATION', leftX + 10, afterTotalsY + 5);
      doc.fontSize(7).font(fontRegular).fillColor(mutedGray).text(`Hash: ${data.etimsHash || 'ETIMS-SIGNATURE-NOT-AVAILABLE'}`, leftX + 10, afterTotalsY + 15, { width: contentWidth - 110 });
      doc.fontSize(8).font(fontBold).fillColor('#059669').text('eTIMS Validated', leftX + contentWidth - 95, afterTotalsY + 9);
      afterTotalsY += 36;
    }

    // Notes and Terms (Cleaned of any CR or Eth corruption)
    const cleanNotes = this.cleanText(data.notes);
    const cleanTerms = this.cleanText(data.terms);

    if (df.showNotes !== false && cleanNotes) {
      doc.fontSize(8.5).font(fontBold).fillColor(darkSlate).text(isInvoice ? 'Notes:' : 'Scope Notes:', leftX, afterTotalsY);
      afterTotalsY = doc.y + 2;
      doc.fontSize(8).font(fontRegular).fillColor(mutedGray);
      const noteLines = cleanNotes.split('\n');
      for (const line of noteLines) {
        doc.text(line, leftX, afterTotalsY, { width: contentWidth });
        afterTotalsY = doc.y + 1;
      }
      afterTotalsY += 6;
    }

    if (df.showTerms !== false && cleanTerms) {
      doc.fontSize(8.5).font(fontBold).fillColor(darkSlate).text(isInvoice ? 'Terms & Conditions:' : 'Quotation Terms & Validity:', leftX, afterTotalsY);
      afterTotalsY = doc.y + 2;
      doc.fontSize(8).font(fontRegular).fillColor(mutedGray);
      const termLines = cleanTerms.split('\n');
      for (const line of termLines) {
        doc.text(line, leftX, afterTotalsY, { width: contentWidth });
        afterTotalsY = doc.y + 1;
      }
    }

    doc.end();
  }

  /**
   * Helper to fetch logo buffer
   */
  private async getLogoBuffer(logoUrl?: string | null): Promise<Buffer | null> {
    if (!logoUrl) return null;
    try {
      if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        const response = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 4000 });
        return Buffer.from(response.data);
      } else {
        const cleanPath = logoUrl.startsWith('/') ? logoUrl.slice(1) : logoUrl;
        const fullPath = path.join(process.cwd(), 'public', cleanPath);
        if (fs.existsSync(fullPath)) {
          return fs.readFileSync(fullPath);
        }
      }
    } catch {}
    return null;
  }
}

export const pdfService = new PdfService();
export default pdfService;
