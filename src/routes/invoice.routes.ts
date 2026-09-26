// ══════════════════════════════════════════════════════════════════════
// Invoice Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import invoiceController from '../controllers/InvoiceController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', invoiceController.index);
router.get('/new', invoiceController.showNew);
router.post('/new', invoiceController.create);
router.get('/:id', invoiceController.show);

export default router;
