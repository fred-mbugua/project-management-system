// ══════════════════════════════════════════════════════════════════════
// Authentication Controller
// Handles login, registration (tenant onboarding), and logout
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withTransaction } from '../config/database';
import {
  UserModel,
  TenantModel,
  SubscriptionModel,
  AuditLogModel,
  UserRole,
  SubscriptionTier,
  SubscriptionStatus,
  AuditAction,
} from '../models';
import ActionLogService from '../services/actionLog.service';
import logger from '../utils/logger';

const authLogger = logger.child('AuthController');

// ──────────────────────────────────────────────
// Validation Schemas
// ──────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phone: z.string().optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export class AuthController {
  /**
   * Render login page
   */
  showLogin = async (_req: Request, res: Response): Promise<void> => {
    res.render('pages/auth/login', {
      title: 'Sign In',
      layout: 'layouts/auth',
    });
  };

  /**
   * Process login form
   */
  handleLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validation = loginSchema.safeParse(req.body);

      if (!validation.success) {
        const errors = validation.error.issues.map((e: any) => e.message);
        req.flash('error', errors.join('. '));
        res.redirect('/auth/login');
        return;
      }

      const { email, password } = validation.data;

      // Find user by email using raw SQL UserModel
      const user = await UserModel.findByEmail(email);

      if (!user || !user.isActive) {
        req.flash('error', 'Invalid email or password.');
        res.redirect('/auth/login');
        return;
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        req.flash('error', 'Invalid email or password.');
        res.redirect('/auth/login');
        return;
      }

      // Check tenant is active (for non-super-admin users)
      if (user.role !== UserRole.SUPER_ADMIN && user.tenant && !user.tenant.isActive) {
        req.flash('error', 'Your organization account has been deactivated. Please contact support.');
        res.redirect('/auth/login');
        return;
      }

      // Update last login
      await UserModel.updateLastLogin(user.id);

      // Create session
      req.session.userId = user.id;
      req.session.tenantId = user.tenantId ?? null;
      req.session.role = user.role;

      authLogger.info('User logged in', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      // Action Log
      await ActionLogService.record(req, {
        action: AuditAction.LOGIN,
        entityType: 'USER',
        entityId: user.id,
        description: `User ${user.email} signed into workspace`,
        metadata: { role: user.role, email: user.email },
      });

      // Redirect to intended page or dashboard
      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;

      req.flash('success', `Welcome back, ${user.firstName}!`);
      res.redirect(returnTo);
    } catch (error) {
      authLogger.error('Login error', { error: String(error) });
      next(error);
    }
  };

  /**
   * Render registration page (Tenant Onboarding)
   */
  showRegister = async (_req: Request, res: Response): Promise<void> => {
    res.render('pages/auth/register', {
      title: 'Create Account',
      layout: 'layouts/auth',
    });
  };

  /**
   * Process registration form - Creates tenant + owner user via raw SQL transaction
   */
  handleRegister = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validation = registerSchema.safeParse(req.body);

      if (!validation.success) {
        const errors = validation.error.issues.map((e: any) => e.message);
        req.flash('error', errors.join('. '));
        res.redirect('/auth/register');
        return;
      }

      const { companyName, email, password, firstName, lastName, phone } = validation.data;

      // Check if email already exists
      const existingUser = await UserModel.findByEmail(email);

      if (existingUser) {
        req.flash('error', 'An account with this email already exists.');
        res.redirect('/auth/register');
        return;
      }

      // Generate slug from company name
      const slug = companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      // Check slug uniqueness
      const existingTenant = await TenantModel.findBySlug(slug);
      const finalSlug = existingTenant
        ? `${slug}-${Date.now().toString(36)}`
        : slug;

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create tenant and owner in an atomic PostgreSQL transaction
      const result = await withTransaction(async (client) => {
        // 1. Create tenant
        const tenant = await TenantModel.create(
          {
            name: companyName,
            slug: finalSlug,
            email: email.toLowerCase(),
            phone: phone || null,
          },
          client
        );

        // 2. Create owner user
        const user = await UserModel.create(
          {
            tenantId: tenant.id,
            email: email.toLowerCase(),
            passwordHash,
            firstName,
            lastName,
            phone: phone || null,
            role: UserRole.TENANT_OWNER,
          },
          client
        );

        // 3. Create trial subscription
        const starterPlan = await SubscriptionModel.findPlanByTier(
          SubscriptionTier.STARTER,
          client
        );

        if (starterPlan) {
          await SubscriptionModel.createTenantSubscription(
            {
              tenantId: tenant.id,
              planId: starterPlan.id,
              status: SubscriptionStatus.TRIAL,
              billingCycle: 'monthly',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trial
              autoRenew: true,
            },
            client
          );
        }

        // 4. Create audit log
        await AuditLogModel.create(
          {
            tenantId: tenant.id,
            userId: user.id,
            action: AuditAction.CREATE,
            entityType: 'Tenant',
            entityId: tenant.id,
            description: `New tenant "${companyName}" registered by ${firstName} ${lastName}`,
            ipAddress: req.ip || 'unknown',
          },
          client
        );

        return { tenant, user };
      });

      authLogger.info('New tenant registered', {
        tenantId: result.tenant.id,
        userId: result.user.id,
        companyName,
      });

      // Auto-login after registration
      req.session.userId = result.user.id;
      req.session.tenantId = result.tenant.id;
      req.session.role = result.user.role;

      req.flash('success', `Welcome to PM & ERP! Your workspace "${companyName}" is ready.`);
      res.redirect('/dashboard');
    } catch (error) {
      authLogger.error('Registration error', { error: String(error) });
      next(error);
    }
  };

  /**
   * Handle logout
   */
  handleLogout = async (req: Request, res: Response): Promise<void> => {
    const userId = req.session?.userId;

    if (userId) {
      await ActionLogService.record(req, {
        action: AuditAction.LOGOUT,
        entityType: 'USER',
        entityId: userId,
        description: 'User signed out of workspace',
      });
    }

    req.session.destroy((err) => {
      if (err) {
        authLogger.error('Session destruction error', { error: String(err) });
      }

      res.clearCookie('pmerp.sid');
      authLogger.info('User logged out', { userId });
      res.redirect('/auth/login');
    });
  };
}

export default new AuthController();
