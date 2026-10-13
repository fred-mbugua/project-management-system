import { Router } from 'express';
import projectController from '../controllers/ProjectController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';
import { uploadDocument } from '../middleware/upload';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('projects', 'view'), projectController.index);
router.get('/new', requireModuleAccess('projects', 'manage'), projectController.showNew);
router.post('/new', requireModuleAccess('projects', 'manage'), projectController.create);
router.get('/:id', requireModuleAccess('projects', 'view'), projectController.show);
router.post('/:id/tasks', requireModuleAccess('projects', 'view'), projectController.addTask);
router.post('/:id/documents', requireModuleAccess('projects', 'view'), uploadDocument.single('document'), projectController.uploadDocument);
router.post('/:id/documents/:docId/delete', requireModuleAccess('projects', 'manage'), projectController.deleteDocument);
router.post('/:id/members', requireModuleAccess('projects', 'manage'), projectController.addMember);
router.post('/:id/members/:memberId/delete', requireModuleAccess('projects', 'manage'), projectController.removeMember);
router.post('/:id/tasks/:taskId/delete', requireModuleAccess('projects', 'manage'), projectController.deleteTask);
router.post('/:id/delete', requireModuleAccess('projects', 'manage'), projectController.deleteProject);

export default router;
