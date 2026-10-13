// ══════════════════════════════════════════════════════════════════════
// Accounting Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import accountingController from '../controllers/AccountingController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('accounting', 'view'), accountingController.index);

export default router;
