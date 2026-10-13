// ══════════════════════════════════════════════════════════════════════
// Client Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import clientController from '../controllers/ClientController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('clients', 'view'), clientController.index);
router.get('/new', requireModuleAccess('clients', 'manage'), clientController.showNew);
router.post('/new', requireModuleAccess('clients', 'manage'), clientController.create);

export default router;
