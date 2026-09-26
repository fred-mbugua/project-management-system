// ══════════════════════════════════════════════════════════════════════
// Authentication Routes
// Login, Register, Logout
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { redirectIfAuth } from '../middleware/auth';

const router = Router();
const authController = new AuthController();

// Login
router.get('/login', redirectIfAuth, authController.showLogin);
router.post('/login', redirectIfAuth, authController.handleLogin);

// Register (Tenant Onboarding)
router.get('/register', redirectIfAuth, authController.showRegister);
router.post('/register', redirectIfAuth, authController.handleRegister);

// Logout
router.post('/logout', authController.handleLogout);

export default router;
