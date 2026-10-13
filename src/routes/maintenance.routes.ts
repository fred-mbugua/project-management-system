// ══════════════════════════════════════════════════════════════════════
// Maintenance Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import maintenanceController from '../controllers/MaintenanceController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('maintenance', 'view'), maintenanceController.index);
router.post('/new', requireModuleAccess('maintenance', 'manage'), maintenanceController.create);
router.post('/run-billing', requireModuleAccess('maintenance', 'manage'), maintenanceController.triggerAutoBilling);
router.get('/:id/invoices', requireModuleAccess('maintenance', 'view'), maintenanceController.getContractInvoices);
router.post('/:id/generate-now', requireModuleAccess('maintenance', 'manage'), maintenanceController.generateInvoiceNow);
router.post('/:id/toggle-status', requireModuleAccess('maintenance', 'manage'), maintenanceController.toggleStatus);
router.post('/:id/delete', requireModuleAccess('maintenance', 'manage'), maintenanceController.deleteSchedule);

export default router;
