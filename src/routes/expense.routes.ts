// ══════════════════════════════════════════════════════════════════════
// Expense Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import expenseController from '../controllers/ExpenseController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireModuleAccess } from '../middleware/rbac';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', requireModuleAccess('expenses', 'view'), expenseController.index);
router.post('/new', requireModuleAccess('expenses', 'manage'), expenseController.create);

export default router;
