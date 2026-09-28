// ══════════════════════════════════════════════════════════════════════
// Invoice Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import invoiceController from '../controllers/InvoiceController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { uploadDocument } from '../middleware/upload';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', invoiceController.index);
router.get('/new', invoiceController.showNew);
router.post('/new', invoiceController.create);
router.get('/:id', invoiceController.show);
router.post('/:id/customize', invoiceController.customize);
router.get('/:id/pdf', invoiceController.downloadPdf);
router.post('/:id/status', invoiceController.updateStatus);
router.post('/:id/payments/manual', uploadDocument.single('proofDocument'), invoiceController.recordManualPayment);

export default router;
