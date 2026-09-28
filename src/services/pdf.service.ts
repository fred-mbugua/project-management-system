// ══════════════════════════════════════════════════════════════════════
// High-Fidelity Multi-Template Document PDF Generation Service
// Renders exact HTML/CSS templates via headless Chrome / Edge
// with automatic fallback to native PDFKit generator
// ══════════════════════════════════════════════════════════════════════

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
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
  private findBrowserExecutable(): string | null {
    const candidatePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      process.env.CHROME_BIN,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe') : '',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ].filter(Boolean) as string[];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
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
      pdfLogger.warn('No Chrome/Edge executable found on system. Falling back to native PDFKit.');
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
    const clientHeading = isInvoice ? 'Billed To:' : 'ESTIMATE PREPARED FOR:';
    const totalHeading = isInvoice ? 'Grand Total:' : 'Estimated Total:';

    const tenantName = this.escapeHtml(data.tenant.name || 'Organization');
    const clientName = this.escapeHtml(data.client.name || 'Valued Client');

    const logoDataUri = await this.getLogoDataUri(data.tenant.logoUrl);
    let logoHtml = '';
    if (logoDataUri) {
      logoHtml = `<div class="doc-logo-wrapper" style="margin-bottom: 12px;">
        <img src="${logoDataUri}" alt="${tenantName} Logo" class="doc-brand-logo" style="max-height: 60px; max-width: 220px; object-fit: contain;">
      </div>`;
    }

    const itemsRows = data.items.map((it, idx) => {
      const qty = parseFloat(String(it.quantity)) || 1;
      const price = parseFloat(String(it.unitPrice)) || 0;
      const lineTotal = it.lineTotal
        ? parseFloat(String(it.lineTotal))
        : qty * price * (df.showTaxBreakdown !== false ? 1.16 : 1);

      return `<tr>
        <td>${idx + 1}</td>
        <td><strong>${this.escapeHtml(it.description)}</strong></td>
        <td class="text-right">${qty}</td>
        <td class="text-right">${this.formatNumber(price)}</td>
        ${df.showTaxBreakdown !== false ? `<td class="text-right"><span class="badge badge-subtle">16% VAT</span></td>` : ''}
        <td class="text-right font-bold">${this.formatNumber(lineTotal)}</td>
      </tr>`;
    }).join('');

    const statusBadge = `<span class="badge ${
      data.status === 'PAID' || data.status === 'CONVERTED'
        ? 'badge-success'
        : data.status === 'SENT'
        ? 'badge-info'
        : 'badge-subtle'
    }">
      <span class="badge-dot"></span>
      ${this.escapeHtml(data.status)}
    </span>`;

    const hasBank = df.showBankDetails !== false && data.tenant.bankDetails;
    const hasMpesa = df.showMpesaDetails !== false && data.tenant.darajaShortcode;
    const settlementHtml = (hasBank || hasMpesa) ? `
      <div class="invoice-settlement-card mb-6">
        <h4 class="invoice-settlement-title">
          <span>Payment &amp; Settlement Details</span>
        </h4>
        <div class="invoice-settlement-grid">
          ${hasBank ? `
            <div class="settlement-grid-item">
              <span class="settlement-label">Bank Settlement Account:</span>
              <p class="settlement-value">${this.escapeHtml(data.tenant.bankDetails)}</p>
            </div>
          ` : ''}
          ${hasMpesa ? `
            <div class="settlement-grid-item">
              <span class="settlement-label">Safaricom M-Pesa ${this.escapeHtml(data.tenant.darajaShortcodeType || 'PAYBILL')}:</span>
              <p class="settlement-value">
                Shortcode: <strong>${this.escapeHtml(data.tenant.darajaShortcode)}</strong> &bull; Ref / Account: <strong>${this.escapeHtml(data.documentNumber)}</strong>
              </p>
            </div>
          ` : ''}
        </div>
      </div>
    ` : '';

    const hasNotes = df.showNotes !== false && data.notes;
    const hasTerms = df.showTerms !== false && data.terms;
    const notesHtml = (hasNotes || hasTerms) ? `
      <div class="invoice-notes-terms ${data.type}-notes-terms">
        ${hasNotes ? `<p class="mb-1"><strong>${isInvoice ? 'Invoice Notes:' : 'Scope Notes:'}</strong> ${this.escapeHtml(data.notes)}</p>` : ''}
        ${hasTerms ? `<p><strong>${isInvoice ? 'Payment Terms:' : 'Quotation Terms &amp; Validity:'}</strong> ${this.escapeHtml(data.terms)}</p>` : ''}
      </div>
    ` : '';

    const etimsHtml = (isInvoice && df.showEtimsQr !== false && data.etimsHash) ? `
      <div class="invoice-etims-banner">
        <div class="invoice-etims-info">
          <div class="invoice-etims-title">KRA eTIMS Tax Compliance Verification</div>
          <div class="invoice-etims-hash">Hash: ${this.escapeHtml(data.etimsHash)}</div>
        </div>
        <div class="badge badge-success">
          <span class="badge-dot"></span>
          eTIMS Validated
        </div>
      </div>
    ` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${docTypeLabel} - ${this.escapeHtml(data.documentNumber)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    ${this.getEmbeddedCss()}

    @page {
      size: A4 portrait;
      margin: 10mm 12mm 12mm 12mm;
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
      color: #1e293b !important;
      font-family: var(--font-primary, 'Plus Jakarta Sans', sans-serif);
      font-size: 13px;
      width: 100% !important;
    }
    .document-sheet, .quotation-sheet, .invoice-sheet {
      box-shadow: none !important;
      max-width: 100% !important;
      width: 100% !important;
      margin: 0 auto !important;
      box-sizing: border-box !important;
    }

    /* Template-specific padding and frames */
    .template-executive {
      border: 2px solid var(--doc-accent) !important;
      border-radius: var(--border-radius-lg) !important;
      outline: 1px solid var(--border-color) !important;
      outline-offset: -6px !important;
      padding: 24px 28px !important;
      background: #ffffff !important;
    }
    .template-classic {
      border: 4px double var(--doc-accent) !important;
      border-radius: 0 !important;
      padding: 24px 28px !important;
      background: #ffffff !important;
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
      font-weight: 700 !important;
    }
    .template-classic .invoice-meta-block h3,
    .template-classic .quotation-meta-block h3 {
      font-family: Georgia, 'Times New Roman', serif !important;
      font-size: 18px !important;
      letter-spacing: 0.02em !important;
    }
    .template-classic .invoice-party-col,
    .template-classic .quotation-party-col {
      border: 1px solid #e2e8f0 !important;
      padding: 14px 18px !important;
      background: #f8fafc !important;
      border-radius: 4px !important;
      margin-bottom: 20px !important;
    }
    .template-classic .invoice-party-name,
    .template-classic .quotation-party-name {
      font-family: Georgia, 'Times New Roman', serif !important;
      font-size: 16px !important;
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
      font-size: 12px !important;
      letter-spacing: 0.03em !important;
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
      font-size: 15px !important;
      font-weight: 700 !important;
    }
    .template-creative {
      border-left: 10px solid var(--doc-accent) !important;
      border-radius: var(--border-radius-lg) !important;
      padding: 24px 28px !important;
    }
    .template-modern {
      padding: 20px 24px !important;
      border-radius: var(--border-radius-lg) !important;
    }
    .template-minimal {
      border: none !important;
      box-shadow: none !important;
      padding: 16px 20px !important;
      background: transparent !important;
    }
    .template-compact {
      border: 1px solid var(--border-color) !important;
      padding: 16px 20px !important;
    }
    .template-corporate, .template-bold {
      padding: 0 !important;
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
      table-layout: auto !important;
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
    }
    .invoice-total-line, .quotation-total-line {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      gap: 16px !important;
      white-space: nowrap !important;
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
          ${df.showTenantAddress !== false ? `<p>${this.escapeHtml(data.tenant.address || (data.tenant.city ? data.tenant.city + ', Kenya' : 'Nairobi, Kenya'))}</p>` : ''}
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
        ${df.showProject !== false && data.project?.code ? `<p>Project: <strong>${this.escapeHtml(data.project.code)}</strong></p>` : ''}
      </div>
    </div>

    <!-- Client / Prepared For -->
    <div class="invoice-parties-grid ${data.type}-parties-grid">
      <div class="invoice-party-col ${data.type}-party-col">
        <h4 class="invoice-party-heading">${clientHeading}</h4>
        <h3 class="invoice-party-name">${clientName}</h3>
        <div class="invoice-party-details">
          ${df.showClientAddress !== false && data.client.address ? `<p>${this.escapeHtml(data.client.address)}</p>` : ''}
          ${df.showClientAddress !== false && data.client.city ? `<p>${this.escapeHtml(data.client.city)}, Kenya</p>` : ''}
          ${df.showClientEmail !== false && data.client.email ? `<p>Email: ${this.escapeHtml(data.client.email)}</p>` : ''}
          ${df.showClientPhone !== false && data.client.phone ? `<p>Phone: ${this.escapeHtml(data.client.phone)}</p>` : ''}
          ${df.showClientKraPin !== false && data.client.kraPin ? `<p><strong>PIN:</strong> ${this.escapeHtml(data.client.kraPin)}</p>` : ''}
        </div>
      </div>
    </div>

    <!-- Items Table -->
    <div class="invoice-table-wrapper ${data.type}-table-wrapper">
      <table class="invoice-table ${data.type}-table">
        <thead>
          <tr>
            <th style="width: 35px;">#</th>
            <th>Item &amp; Service Description</th>
            <th class="text-right" style="width: 60px;">Qty</th>
            <th class="text-right" style="width: 120px;">Unit Price (KES)</th>
            ${df.showTaxBreakdown !== false ? `<th class="text-right" style="width: 90px;">Tax Rate</th>` : ''}
            <th class="text-right" style="width: 120px;">Total (KES)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>
    </div>

    <!-- Totals Area -->
    <div class="invoice-totals-wrapper ${data.type}-totals-wrapper">
      <div class="invoice-totals-box ${data.type}-totals-box">
        <div class="invoice-total-line">
          <span>Subtotal (Net):</span>
          <span>${formatKES(parseFloat(String(data.subtotal)) || 0)}</span>
        </div>
        ${df.showTaxBreakdown !== false ? `
          <div class="invoice-total-line">
            <span>VAT (16% Standard):</span>
            <span>${formatKES(parseFloat(String(data.taxAmount)) || 0)}</span>
          </div>
        ` : ''}
        ${(df.showDiscount !== false && parseFloat(String(data.discountAmount || 0)) > 0) ? `
          <div class="invoice-total-line">
            <span>Special Discount:</span>
            <span>- ${formatKES(parseFloat(String(data.discountAmount)) || 0)}</span>
          </div>
        ` : ''}
        <div class="invoice-total-line invoice-total-line-grand ${data.type}-total-line-grand">
          <span>${totalHeading}</span>
          <span>${formatKES(parseFloat(String(data.totalAmount)) || 0)}</span>
        </div>
        ${isInvoice && parseFloat(String(data.amountPaid || 0)) > 0 ? `
          <div class="invoice-total-line text-success font-medium">
            <span>Amount Paid:</span>
            <span>${formatKES(parseFloat(String(data.amountPaid)) || 0)}</span>
          </div>
        ` : ''}
        ${isInvoice && parseFloat(String(data.balanceDue || 0)) >= 0 ? `
          <div class="invoice-total-line invoice-total-line-balance">
            <span>Balance Due:</span>
            <span>${formatKES(parseFloat(String(data.balanceDue)) || 0)}</span>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Settlement Details -->
    ${settlementHtml}

    <!-- Notes & Terms -->
    ${notesHtml}

    <!-- eTIMS Verification Banner (Invoices) -->
    ${etimsHtml}

  </div>
</body>
</html>`;
  }

  /**
   * Primary entrypoint: Stream PDF directly to Express response
   * Renders with headless Chrome/Edge to ensure exact fidelity with web templates,
   * with automatic fallback to native PDFKit generator.
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
          await page.setContent(html, { waitUntil: 'load' });
          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
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

    // 2. Fallback to PDFKit
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
        await page.setContent(html, { waitUntil: 'load' });
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
        });
        return Buffer.from(pdfBytes);
      } finally {
        await page.close().catch(() => {});
      }
    }

    // Fallback: render using PDFKit into buffer
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const dummyRes: any = {
        setHeader: () => {},
        write: (chunk: Buffer) => chunks.push(chunk),
        end: (finalChunk?: Buffer) => {
          if (finalChunk) chunks.push(finalChunk);
          resolve(Buffer.concat(chunks));
        },
      };
      this.generateDocumentPdfWithPdfKit(data, dummyRes).catch(reject);
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
        <img src="${logoDataUri}" alt="${this.escapeHtml(data.tenant.name)} Logo" style="max-height: 55px; max-width: 200px; object-fit: contain;">
      </div>`;
    }

    const itemsRows = (data.items || []).map((it, idx) => `
      <tr>
        <td style="width: 35px; text-align: center;">${idx + 1}</td>
        <td><strong>${this.escapeHtml(it.description)}</strong></td>
        <td style="text-align: right; width: 60px;">${it.quantity}</td>
        <td style="text-align: right; width: 120px;">${this.formatNumber(it.unitPrice)}</td>
        <td style="text-align: right; width: 130px; font-weight: 700;">${this.formatNumber(it.lineTotal)}</td>
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
      margin: 12mm 14mm 14mm 14mm;
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
        <h2>${this.escapeHtml(data.tenant.name)}</h2>
        <p>${this.escapeHtml(data.tenant.address || 'Nairobi, Kenya')}</p>
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
        <div class="receipt-card-name">${this.escapeHtml(data.client.name)}</div>
        ${rf.showClientAddress && data.client.address ? `<p>${this.escapeHtml(data.client.address)}</p>` : ''}
        ${data.client.email ? `<p>Email: ${this.escapeHtml(data.client.email)}</p>` : ''}
        ${rf.showClientPhone && data.client.phone ? `<p>Phone: ${this.escapeHtml(data.client.phone)}</p>` : ''}
        ${data.client.kraPin ? `<p>PIN: ${this.escapeHtml(data.client.kraPin)}</p>` : ''}
      </div>
      ${rf.showBankDetails && data.tenant.bankDetails ? `
        <div class="receipt-card">
          <div class="receipt-card-title">Settlement Account Verified</div>
          <p><strong>Bank Details:</strong> ${this.escapeHtml(data.tenant.bankDetails)}</p>
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
            <th style="text-align: right; width: 120px;">Unit Price (KES)</th>
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
        await page.setContent(html, { waitUntil: 'load' });
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
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

        doc.fontSize(20).fillColor('#059669').text(data.tenant.name);
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
   * PDFKit fallback generator
   */
  private async generateDocumentPdfWithPdfKit(data: DocumentPdfData, res: Response): Promise<void> {
    const template = (data.template || 'modern').toLowerCase();
    const primaryColor = data.customColor || data.tenant.primaryColor || '#4F46E5';
    const darkSlate = '#1E293B';
    const mutedGray = '#64748B';
    const borderGray = '#E2E8F0';
    const lightBg = '#F8FAFC';

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
      margin: template === 'compact' ? 35 : 40,
      info: {
        Title: `${data.type === 'invoice' ? 'Invoice' : 'Quotation'} ${data.documentNumber}`,
        Author: data.tenant.name,
        Subject: data.title || 'Commercial Document',
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

    let leftX = 40;
    let rightColX = 350;
    let contentWidth = 515;
    let topY = 40;

    if (template === 'corporate') {
      doc.rect(0, 0, pageWidth, 90).fill(primaryColor);
      topY = 20;
    } else if (template === 'creative') {
      doc.rect(0, 0, 16, pageHeight).fill(primaryColor);
      leftX = 48;
      contentWidth = 507;
      rightColX = 355;
    } else if (template === 'classic') {
      doc.rect(20, 20, pageWidth - 40, pageHeight - 40).strokeColor(primaryColor).lineWidth(2).stroke();
      doc.rect(23, 23, pageWidth - 46, pageHeight - 46).strokeColor(primaryColor).lineWidth(0.75).stroke();
      leftX = 42;
      contentWidth = 511;
      rightColX = 350;
    } else if (template === 'executive') {
      doc.roundedRect(20, 20, pageWidth - 40, pageHeight - 40, 10).strokeColor(primaryColor).lineWidth(2).stroke();
      doc.roundedRect(24, 24, pageWidth - 48, pageHeight - 48, 8).strokeColor(borderGray).lineWidth(0.75).stroke();
      leftX = 45;
      contentWidth = 505;
      rightColX = 340;
    } else if (template === 'bold') {
      doc.rect(0, 0, pageWidth, 100).fill(primaryColor);
      topY = 25;
    }

    let brandTextX = leftX;
    let headerLogoY = topY;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, leftX, headerLogoY, { fit: [110, 45] });
        brandTextX = leftX + 120;
      } catch {}
    }

    const headerTextColor = (template === 'corporate' || template === 'bold') ? '#FFFFFF' : darkSlate;
    const headerMutedColor = (template === 'corporate' || template === 'bold') ? '#E2E8F0' : mutedGray;

    const brandWidth = rightColX - brandTextX - 15;
    doc.fillColor(headerTextColor).fontSize(15).font(fontBold).text(data.tenant.name, brandTextX, topY, { width: brandWidth });
    let vendorY = doc.y + 3;

    doc.fontSize(8.5).font(fontRegular).fillColor(headerMutedColor);
    if (df.showTenantAddress !== false) {
      const tenantAddr = data.tenant.address || (data.tenant.city ? data.tenant.city + ', Kenya' : 'Nairobi, Kenya');
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

    const metaTitle = data.type === 'invoice' ? 'TAX INVOICE' : 'COMMERCIAL QUOTATION';
    const metaColWidth = leftX + contentWidth - rightColX;
    doc.fillColor(headerTextColor).fontSize(14).font(fontBold).text(metaTitle, rightColX, topY, { width: metaColWidth, align: 'right' });
    doc.fillColor(headerTextColor).fontSize(12).font(fontBold).text(data.documentNumber, rightColX, doc.y + 2, { width: metaColWidth, align: 'right' });

    let metaY = doc.y + 4;
    doc.fontSize(8.5).font(fontRegular).fillColor(headerMutedColor);
    doc.text(`Issue Date: ${this.formatDate(data.issueDate)}`, rightColX, metaY, { width: metaColWidth, align: 'right' });
    metaY = doc.y + 2;
    if (df.showPaymentTerms !== false && data.dueDateOrValidUntil) {
      doc.text(`${data.dueDateLabel}: ${this.formatDate(data.dueDateOrValidUntil)}`, rightColX, metaY, { width: metaColWidth, align: 'right' });
      metaY = doc.y + 2;
    }
    if (df.showProject !== false && data.project?.code) {
      doc.text(`Project: ${data.project.code}`, rightColX, metaY, { width: metaColWidth, align: 'right' });
    }

    const headerBottomY = Math.max(vendorY, doc.y, topY + 70);
    let partiesTopY = (template === 'corporate' || template === 'bold') ? 115 : headerBottomY + 16;

    if (template === 'modern') {
      doc.moveTo(leftX, partiesTopY - 8).lineTo(leftX + contentWidth, partiesTopY - 8).strokeColor(primaryColor).lineWidth(1.5).stroke();
    }

    doc.fillColor(darkSlate).fontSize(9).font(fontBold).text(data.type === 'invoice' ? 'BILLED TO:' : 'ESTIMATE PREPARED FOR:', leftX, partiesTopY);
    let clientY = doc.y + 3;
    doc.fontSize(10).font(fontBold).fillColor(darkSlate).text(data.client.name, leftX, clientY);
    clientY = doc.y + 2;

    doc.fontSize(8.5).font(fontRegular).fillColor(mutedGray);
    if (df.showClientAddress !== false && data.client.address) {
      doc.text(`${data.client.address}${data.client.city ? ', ' + data.client.city : ''}`, leftX, clientY);
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
      doc.text(`PIN: ${data.client.kraPin}`, leftX, clientY);
      clientY = doc.y + 2;
    }

    const tableTopY = Math.max(clientY, partiesTopY + 50) + 12;
    const hasVatCol = df.showTaxBreakdown !== false;
    const descW = hasVatCol ? 230 : 295;
    const qtyW = 35;
    const priceW = 75;
    const vatW = hasVatCol ? 65 : 0;
    const totalW = 100;

    const qtyX = leftX + descW;
    const priceX = qtyX + qtyW;
    const vatX = priceX + priceW;
    const totalX = vatX + vatW;

    doc.rect(leftX, tableTopY, contentWidth, 22).fill(primaryColor);
    doc.fillColor('#FFFFFF').fontSize(8.5).font(fontBold);
    doc.text('Item Description', leftX + 10, tableTopY + 6, { width: descW - 15 });
    doc.text('Qty', qtyX, tableTopY + 6, { width: qtyW, align: 'center' });
    doc.text('Unit Price (KES)', priceX, tableTopY + 6, { width: priceW, align: 'right' });
    if (hasVatCol) {
      doc.text('VAT (16%)', vatX, tableTopY + 6, { width: vatW, align: 'right' });
    }
    doc.text('Total (KES)', totalX, tableTopY + 6, { width: totalW - 10, align: 'right' });

    let currentY = tableTopY + 22;
    data.items.forEach((item, index) => {
      const isAlt = index % 2 === 1;
      if (isAlt) {
        doc.rect(leftX, currentY, contentWidth, 22).fill('#FBFBFC');
      }
      doc.rect(leftX, currentY, contentWidth, 22).stroke(borderGray);

      const qty = parseFloat(String(item.quantity)) || 1;
      const price = parseFloat(String(item.unitPrice)) || 0;
      const tax = item.lineTax ? parseFloat(String(item.lineTax)) : qty * price * 0.16;
      const total = item.lineTotal ? parseFloat(String(item.lineTotal)) : qty * price * (hasVatCol ? 1.16 : 1);

      doc.fillColor(darkSlate).fontSize(8.5).font(fontRegular);
      doc.text(item.description, leftX + 10, currentY + 6, { width: descW - 15, ellipsis: true });
      doc.text(String(qty), qtyX, currentY + 6, { width: qtyW, align: 'center' });
      doc.text(this.formatNumber(price), priceX, currentY + 6, { width: priceW, align: 'right' });
      if (hasVatCol) {
        doc.text(this.formatNumber(tax), vatX, currentY + 6, { width: vatW, align: 'right' });
      }
      doc.font(fontBold).text(this.formatNumber(total), totalX, currentY + 6, { width: totalW - 10, align: 'right' });
      currentY += 22;
    });

    const totalsBoxW = 200;
    const totalsBoxX = leftX + contentWidth - totalsBoxW;
    let totalsBoxY = currentY + 12;

    doc.rect(totalsBoxX, totalsBoxY, totalsBoxW, 85).fill(lightBg).stroke(borderGray);
    doc.fontSize(8.5).font(fontRegular).fillColor(mutedGray);
    doc.text('Subtotal (Net):', totalsBoxX + 10, totalsBoxY + 8);
    doc.font(fontBold).fillColor(darkSlate).text(formatKES(parseFloat(String(data.subtotal)) || 0), totalsBoxX + 80, totalsBoxY + 8, { width: totalsBoxW - 90, align: 'right' });

    let tY = totalsBoxY + 22;
    if (df.showTaxBreakdown !== false) {
      doc.font(fontRegular).fillColor(mutedGray).text('VAT (16%):', totalsBoxX + 10, tY);
      doc.font(fontBold).fillColor(darkSlate).text(formatKES(parseFloat(String(data.taxAmount)) || 0), totalsBoxX + 80, tY, { width: totalsBoxW - 90, align: 'right' });
      tY += 14;
    }

    doc.moveTo(totalsBoxX + 10, tY + 2).lineTo(totalsBoxX + totalsBoxW - 10, tY + 2).strokeColor(primaryColor).lineWidth(1).stroke();
    doc.fontSize(9.5).font(fontBold).fillColor(primaryColor);
    doc.text(data.type === 'invoice' ? 'Grand Total:' : 'Estimated Total:', totalsBoxX + 10, tY + 6);
    doc.text(formatKES(parseFloat(String(data.totalAmount)) || 0), totalsBoxX + 80, tY + 6, { width: totalsBoxW - 90, align: 'right' });

    let afterTotalsY = Math.max(tY + 30, totalsBoxY + 95);

    if (df.showBankDetails !== false && data.tenant.bankDetails) {
      doc.fontSize(8.5).font(fontBold).fillColor(darkSlate).text('Bank Settlement Account:', leftX, afterTotalsY);
      doc.font(fontRegular).fillColor(mutedGray).text(data.tenant.bankDetails, leftX, doc.y + 2);
      afterTotalsY = doc.y + 6;
    }

    if (df.showMpesaDetails !== false && data.tenant.darajaShortcode) {
      doc.fontSize(8.5).font(fontBold).fillColor(darkSlate).text(`Safaricom M-Pesa ${data.tenant.darajaShortcodeType || 'PAYBILL'}:`, leftX, afterTotalsY);
      doc.font(fontRegular).fillColor(mutedGray).text(`Shortcode: ${data.tenant.darajaShortcode} • Account / Ref: ${data.documentNumber}`, leftX, doc.y + 2);
      afterTotalsY = doc.y + 6;
    }

    if (df.showNotes !== false && data.notes) {
      doc.fontSize(8.5).font(fontBold).fillColor(darkSlate).text(data.type === 'invoice' ? 'Notes:' : 'Scope Notes:', leftX, afterTotalsY);
      doc.font(fontRegular).fillColor(mutedGray).text(data.notes, leftX, doc.y + 2);
      afterTotalsY = doc.y + 6;
    }

    if (df.showTerms !== false && data.terms) {
      doc.fontSize(8.5).font(fontBold).fillColor(darkSlate).text('Terms & Conditions:', leftX, afterTotalsY);
      doc.font(fontRegular).fillColor(mutedGray).text(data.terms, leftX, doc.y + 2);
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
