import { Router } from 'express';
import profileController from '../controllers/ProfileController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// All profile operations require an authenticated session
router.use(requireAuth);

// GET /profile - View user profile
router.get('/', profileController.showProfile);

// POST /profile/contact - Update personal & contact details
router.post('/contact', profileController.updateContact);

// POST /profile/password - Change user password
router.post('/password', profileController.updatePassword);

export default router;
