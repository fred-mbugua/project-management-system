// ══════════════════════════════════════════════════════════════════════
// Calendar Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import calendarController from '../controllers/CalendarController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('calendar', 'view'), calendarController.index);

export default router;
