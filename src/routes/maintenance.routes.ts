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

export default router;
