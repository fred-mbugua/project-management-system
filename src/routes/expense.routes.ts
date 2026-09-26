// ══════════════════════════════════════════════════════════════════════
// Expense Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import expenseController from '../controllers/ExpenseController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';

const router = Router();

router.use(requireAuth, resolveTenant);

router.get('/', expenseController.index);
router.post('/new', expenseController.create);

export default router;
