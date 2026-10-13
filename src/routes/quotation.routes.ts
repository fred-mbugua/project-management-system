// ══════════════════════════════════════════════════════════════════════
// Quotation Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import quotationController from '../controllers/QuotationController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('quotations', 'view'), quotationController.index);
router.get('/new', requireModuleAccess('quotations', 'manage'), quotationController.showNew);
router.post('/new', requireModuleAccess('quotations', 'manage'), quotationController.create);
router.get('/:id', requireModuleAccess('quotations', 'view'), quotationController.show);
router.get('/:id/pdf', requireModuleAccess('quotations', 'view'), quotationController.downloadPdf);
router.get('/:id/edit', requireModuleAccess('quotations', 'manage'), quotationController.showEdit);
router.post('/:id/edit', requireModuleAccess('quotations', 'manage'), quotationController.update);
router.post('/:id/delete', requireModuleAccess('quotations', 'manage'), quotationController.deleteQuotation);
router.post('/:id/convert', requireModuleAccess('quotations', 'manage'), quotationController.convertToInvoice);

export default router;

