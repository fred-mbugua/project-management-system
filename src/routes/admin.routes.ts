// ══════════════════════════════════════════════════════════════════════
// Admin Routes (Platform Management)
// Restricted strictly to SUPER_ADMIN
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import adminController from '../controllers/AdminController';
import { requireAuth } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/rbac';

const router = Router();

// Apply authentication and super admin guard to all admin routes
router.use(requireAuth, requireSuperAdmin);

// Tenants Management
router.get('/tenants', adminController.listTenants);
router.get('/tenants/new', adminController.showNewTenant);
router.post('/tenants/new', adminController.handleCreateTenant);

// Subscription Plans
router.get('/plans', adminController.listPlans);

export default router;
