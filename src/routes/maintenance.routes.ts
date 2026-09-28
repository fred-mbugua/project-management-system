// ══════════════════════════════════════════════════════════════════════
// Maintenance Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import maintenanceController from '../controllers/MaintenanceController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', maintenanceController.index);
router.post('/new', maintenanceController.create);
router.post('/run-billing', maintenanceController.triggerAutoBilling);
router.get('/:id/invoices', maintenanceController.getContractInvoices);
router.post('/:id/generate-now', maintenanceController.generateInvoiceNow);
router.post('/:id/toggle-status', maintenanceController.toggleStatus);
router.post('/:id/delete', maintenanceController.deleteSchedule);

export default router;
