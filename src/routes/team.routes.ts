// ══════════════════════════════════════════════════════════════════════
// Team Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import teamController from '../controllers/TeamController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('team', 'view'), teamController.index);
router.get('/new', requireModuleAccess('team', 'manage'), teamController.showNew);
router.post('/new', requireModuleAccess('team', 'manage'), teamController.create);
router.get('/:id/edit', requireModuleAccess('team', 'manage'), teamController.showEdit);
router.post('/:id/edit', requireModuleAccess('team', 'manage'), teamController.update);
router.post('/:id/toggle-status', requireModuleAccess('team', 'manage'), teamController.toggleStatus);

export default router;
