// ══════════════════════════════════════════════════════════════════════
// Project Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import projectController from '../controllers/ProjectController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { uploadDocument } from '../middleware/upload';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', projectController.index);
router.get('/new', projectController.showNew);
router.post('/new', projectController.create);
router.get('/:id', projectController.show);
router.post('/:id/tasks', projectController.addTask);
router.post('/:id/documents', uploadDocument.single('document'), projectController.uploadDocument);
router.post('/:id/documents/:docId/delete', projectController.deleteDocument);

export default router;
