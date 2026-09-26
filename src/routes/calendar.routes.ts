// ══════════════════════════════════════════════════════════════════════
// Calendar Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import calendarController from '../controllers/CalendarController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', calendarController.index);

export default router;
