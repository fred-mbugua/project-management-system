// ══════════════════════════════════════════════════════════════════════
// Settings Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import settingsController from '../controllers/SettingsController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '../models/types';

const router = Router();

router.use(requireAuth, resolveTenant, requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER));

router.get('/', settingsController.index);
router.post('/', settingsController.update);

export default router;
