// ══════════════════════════════════════════════════════════════════════
// Invoice Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import invoiceController from '../controllers/InvoiceController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { uploadDocument } from '../middleware/upload';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('invoices', 'view'), invoiceController.index);
router.get('/new', requireModuleAccess('invoices', 'manage'), invoiceController.showNew);
router.post('/new', requireModuleAccess('invoices', 'manage'), invoiceController.create);
router.get('/:id', requireModuleAccess('invoices', 'view'), invoiceController.show);
router.post('/:id/customize', requireModuleAccess('invoices', 'manage'), invoiceController.customize);
router.post('/:id/toggle-vat', requireModuleAccess('invoices', 'manage'), invoiceController.toggleVat);
router.get('/:id/pdf', requireModuleAccess('invoices', 'view'), invoiceController.downloadPdf);
router.post('/:id/status', requireModuleAccess('invoices', 'manage'), invoiceController.updateStatus);
router.get('/:id/edit', requireModuleAccess('invoices', 'manage'), invoiceController.showEdit);
router.post('/:id/edit', requireModuleAccess('invoices', 'manage'), invoiceController.update);
router.post('/:id/delete', requireModuleAccess('invoices', 'manage'), invoiceController.deleteInvoice);
router.post('/:id/payments/manual', requireModuleAccess('invoices', 'manage'), uploadDocument.single('proofDocument'), invoiceController.recordManualPayment);

export default router;
