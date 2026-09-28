// ══════════════════════════════════════════════════════════════════════
// Admin Routes (Platform Management)
// Restricted strictly to SUPER_ADMIN
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import adminController from '../controllers/AdminController';
import auditController from '../controllers/AuditController';
import { requireAuth } from '../middleware/auth';
import { requireSuperAdmin } from '../middleware/rbac';

const router = Router();

// Apply authentication and super admin guard to all admin routes
router.use(requireAuth, requireSuperAdmin);

// Tenants Management & Account Control
router.get('/tenants', adminController.listTenants);
router.get('/tenants/new', adminController.showNewTenant);
router.post('/tenants/new', adminController.handleCreateTenant);
router.post('/tenants/:id/suspend', adminController.suspendTenant);
router.post('/tenants/:id/activate', adminController.activateTenant);
router.post('/tenants/:id/subscription', adminController.updateTenantSubscription);
router.post('/tenants/scan-subscriptions', adminController.scanSubscriptions);

// Subscription Plans Management
router.get('/plans', adminController.listPlans);
router.post('/plans', adminController.createPlan);
router.post('/plans/:id', adminController.updatePlan);
router.post('/plans/:id/toggle', adminController.togglePlanStatus);

// System Error Diagnostics
router.get('/error-logs', auditController.errorLogs);

export default router;
