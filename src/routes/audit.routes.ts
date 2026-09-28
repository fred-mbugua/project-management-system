// ══════════════════════════════════════════════════════════════════════
// Audit & Action Logs Routes
// Restricted to SUPER_ADMIN and TENANT_OWNER
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import auditController from '../controllers/AuditController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '../models/types';

const router = Router();

router.use(requireAuth, resolveTenant, requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER));

router.get('/', auditController.index);

export default router;
