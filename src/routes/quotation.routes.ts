// ══════════════════════════════════════════════════════════════════════
// Quotation Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import quotationController from '../controllers/QuotationController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', quotationController.index);
router.get('/new', quotationController.showNew);
router.post('/new', quotationController.create);
router.get('/:id', quotationController.show);
router.post('/:id/convert', quotationController.convertToInvoice);

export default router;

