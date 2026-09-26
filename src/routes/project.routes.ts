// ══════════════════════════════════════════════════════════════════════
// Project Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import projectController from '../controllers/ProjectController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', projectController.index);
router.get('/new', projectController.showNew);
router.post('/new', projectController.create);
router.get('/:id', projectController.show);
router.post('/:id/tasks', projectController.addTask);

export default router;
