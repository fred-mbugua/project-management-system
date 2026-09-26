// ══════════════════════════════════════════════════════════════════════
// Client Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import clientController from '../controllers/ClientController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', clientController.index);
router.get('/new', clientController.showNew);
router.post('/new', clientController.create);

export default router;
