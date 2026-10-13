// ══════════════════════════════════════════════════════════════════════
// Audit & Action Logs Routes
// Restricted to SUPER_ADMIN and TENANT_OWNER
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import auditController from '../controllers/AuditController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('audit_logs', 'view'), auditController.index);

export default router;
