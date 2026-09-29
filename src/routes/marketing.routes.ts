// ═══════════════════════════════════════════════════════════════════
// Marketing & SEO Routes
// Homepage, SEO Landing Pages, XML Sitemap, and Robots.txt
// ═══════════════════════════════════════════════════════════════════

import { Router } from 'express';
import marketingController from '../controllers/MarketingController';

const router = Router();

// Sitemap & Robots (Available at root for Google Search Console)
router.get('/sitemap.xml', marketingController.sitemap);
router.get('/robots.txt', marketingController.robots);

// Main SEO Landing Page
router.get('/', marketingController.home);

// Targeted High-Intent SEO Landing Pages
router.get('/free-invoice-generator', marketingController.freeInvoices);
router.get('/free-quotation-generator', marketingController.freeQuotations);
router.get('/free-project-management', marketingController.freeProjects);
router.get('/pricing', marketingController.pricing);

export default router;
