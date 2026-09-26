// ══════════════════════════════════════════════════════════════════════
// Team Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import teamController from '../controllers/TeamController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '../models/types';

const router = Router();

router.use(requireAuth, resolveTenant, requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER, UserRole.PROJECT_MANAGER));

router.get('/', teamController.index);
router.get('/new', teamController.showNew);
router.post('/new', teamController.create);

export default router;
