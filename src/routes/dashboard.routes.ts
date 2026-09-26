// ══════════════════════════════════════════════════════════════════════
// Dashboard Routes
// Protected by Authentication and Tenant Scoping Middleware
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import dashboardController from '../controllers/DashboardController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

// Main Dashboard View (Role & Tenant adaptive)
router.get('/', requireAuth, resolveTenant, dashboardController.index);

export default router;
