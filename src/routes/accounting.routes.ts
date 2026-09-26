// ══════════════════════════════════════════════════════════════════════
// Accounting Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import accountingController from '../controllers/AccountingController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '../models/types';

const router = Router();

router.use(requireAuth, resolveTenant, requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER, UserRole.ACCOUNTANT));

router.get('/', accountingController.index);

export default router;
