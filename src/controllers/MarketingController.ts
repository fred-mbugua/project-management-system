// ═══════════════════════════════════════════════════════════════════
// Marketing & SEO Controller
// Serves high-intent SEO landing pages, XML sitemap, and robots.txt
// ═══════════════════════════════════════════════════════════════════

import { Request, Response } from 'express';
import { appConfig } from '../config/app';
import { SubscriptionModel } from '../models/subscription.model';

export class MarketingController {
  private baseUrl = appConfig.appUrl.replace(/\/$/, '');

  /**
   * Main Homepage
   * Targets: Free Invoices, Free Quotations Generator, Free Project Management System
   */
  home = async (req: Request, res: Response): Promise<void> => {
    // If user is already authenticated and visits directly, they can choose or be redirected
    if (req.session?.userId && req.query.public !== 'true') {
      res.redirect('/dashboard');
      return;
    }

    let plans: any[] = [];
    try {
      plans = await SubscriptionModel.findAllActivePlans();
    } catch (err) {
      console.error('Error fetching subscription plans for home page:', err);
    }

    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is the invoice generator really free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes! Our Free Starter tier allows you to create, customize, and export professional PDF invoices with your logo, tax/VAT calculations, and bank or M-Pesa payment instructions at zero cost. There are no hidden fees or expiring trials for the free tier.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does the free quotation generator work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'You can build itemized estimates, add service descriptions, quantities, discounts, and validity dates. When your client reviews and approves your quotation, you can convert it into an official active invoice with a single click, eliminating duplicate data entry.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can my clients pay invoices directly with Safaricom M-Pesa?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes! PM & ERP SaaS has built-in integration with Safaricom Daraja API. Clients receive a secure payment link where they can trigger an instant M-Pesa STK push PIN prompt on their phone or view Paybill / Till number payment instructions. When paid, the invoice status updates automatically.',
          },
        },
        {
          '@type': 'Question',
          name: 'What features are included in the free project management system?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'You can create projects, break them down into milestone tasks, assign deadlines, track project expenses against client budgets, monitor maintenance contracts and SLAs, and track overall profitability in real time.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is my business data secure and confidential?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Absolutely. We use bank-grade 256-bit TLS encryption in transit, strict tenant data isolation, daily automated database backups, and password security hashed with 12 rounds of bcrypt.',
          },
        },
      ],
    };

    res.render('pages/marketing/index', {
      layout: 'layouts/public',
      title: 'Free Invoices, Quotation Generator & Project Management System | PM & ERP SaaS',
      metaDescription: 'Generate free professional PDF invoices and business quotations online. Manage client projects, assign tasks, and accept instant M-Pesa & Card payments.',
      metaKeywords: 'free invoices, free quotations generator, free invoice generator, free project management system, online invoicing software, quotation maker, mpesa billing, erp saas, project tracker',
      canonicalUrl: `${this.baseUrl}/`,
      activePage: 'home',
      faqSchema,
      plans,
    });
  };

  /**
   * Free Invoices & Online Invoice Generator Landing
   */
  freeInvoices = (_req: Request, res: Response): void => {
    res.render('pages/marketing/invoices', {
      layout: 'layouts/public',
      title: 'Free Invoices & Online Invoice Generator | PDF Maker with M-Pesa',
      metaDescription: 'Create free invoices online. Download branded PDFs, calculate 16% VAT automatically, and accept Safaricom M-Pesa payments with PM & ERP SaaS.',
      metaKeywords: 'free invoices, free invoice generator, create invoice online, pdf invoice maker, kenya mpesa invoice, vat invoice generator',
      canonicalUrl: `${this.baseUrl}/free-invoice-generator`,
      activePage: 'invoices',
    });
  };

  /**
   * Free Quotations Generator & Quote Maker Landing
   */
  freeQuotations = (_req: Request, res: Response): void => {
    res.render('pages/marketing/quotations', {
      layout: 'layouts/public',
      title: 'Free Quotations Generator & Online Quote Maker | PM & ERP SaaS',
      metaDescription: 'Create professional quotations and estimates for free. Add line items, discounts, validity periods, and convert approved quotes to invoices in 1 click.',
      metaKeywords: 'free quotations generator, quote maker, business estimate generator, online quotation software, convert quote to invoice',
      canonicalUrl: `${this.baseUrl}/free-quotation-generator`,
      activePage: 'quotations',
    });
  };

  /**
   * Free Project Management System Landing
   */
  freeProjects = (_req: Request, res: Response): void => {
    res.render('pages/marketing/projects', {
      layout: 'layouts/public',
      title: 'Free Project Management System & Task Tracking Software | PM & ERP SaaS',
      metaDescription: 'Organize deliverables, assign tasks, track milestone deadlines, and monitor project budgets with our free project management system.',
      metaKeywords: 'free project management system, project tracking software, task management saas, milestone tracker, agency project tool',
      canonicalUrl: `${this.baseUrl}/free-project-management`,
      activePage: 'projects',
    });
  };

  /**
   * Pricing & Monetization Plans Landing
   */
  pricing = async (_req: Request, res: Response): Promise<void> => {
    let plans: any[] = [];
    try {
      plans = await SubscriptionModel.findAllActivePlans();
    } catch (err) {
      console.error('Error fetching subscription plans for pricing page:', err);
    }

    res.render('pages/marketing/pricing', {
      layout: 'layouts/public',
      title: 'Pricing & Monetization Plans | Free Invoices, Quotations & Project SaaS',
      metaDescription: 'Transparent pricing plans. Start with our Starter tier or upgrade to Professional and Enterprise with automated M-Pesa STK push and accounting.',
      metaKeywords: 'invoicing software pricing, project management pricing, saas subscription plans, mpesa billing saas',
      canonicalUrl: `${this.baseUrl}/pricing`,
      activePage: 'pricing',
      plans,
    });
  };

  /**
   * XML Sitemap for Google Search Console
   */
  sitemap = (_req: Request, res: Response): void => {
    const today = new Date().toISOString().split('T')[0];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  <url>
    <loc>${this.baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/free-invoice-generator</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/free-quotation-generator</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/free-project-management</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/pricing</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/auth/register</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${this.baseUrl}/auth/login</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>`;

    res.header('Content-Type', 'application/xml; charset=utf-8');
    res.header('Cache-Control', 'public, max-age=86400');
    res.status(200).send(xml);
  };

  /**
   * Robots.txt
   */
  robots = (_req: Request, res: Response): void => {
    const robots = `# Robots.txt for FreeStyle Code Technologies PM & ERP SaaS
User-agent: *
Allow: /
Allow: /free-invoice-generator
Allow: /free-quotation-generator
Allow: /free-project-management
Allow: /pricing
Allow: /auth/login
Allow: /auth/register
Allow: /manifest.json
Allow: /favicon.svg
Allow: /css/
Allow: /js/
Allow: /icons/

# Disallow indexing of private tenant data
Disallow: /dashboard/
Disallow: /admin/
Disallow: /projects/
Disallow: /invoices/
Disallow: /quotations/
Disallow: /clients/
Disallow: /team/
Disallow: /expenses/
Disallow: /accounting/
Disallow: /settings/
Disallow: /profile/
Disallow: /subscription/
Disallow: /audit-logs/
Disallow: /api/

Sitemap: ${this.baseUrl}/sitemap.xml
`;
    res.header('Content-Type', 'text/plain; charset=utf-8');
    res.header('Cache-Control', 'public, max-age=86400');
    res.status(200).send(robots);
  };
}

export default new MarketingController();
