// ══════════════════════════════════════════════════════════════════════
// Authentication Middleware
// Session-based auth with cookie verification
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { UserModel } from '../models/user.model';
import logger from '../utils/logger';

const authLogger = logger.child('Auth');

/**
 * Require authenticated session. Redirects to login if no valid session exists.
 * Attaches full user object to req.user for downstream middleware and controllers.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.session?.userId;

    if (!userId) {
      authLogger.debug('No session userId found, redirecting to login');
      req.session.returnTo = req.originalUrl;
      req.flash('error', 'Please log in to continue.');
      res.redirect('/auth/login');
      return;
    }

    const user = await UserModel.findById(userId);

    if (!user || !user.isActive) {
      authLogger.warn('User not found or inactive', { userId });
      req.session.destroy(() => {
        res.redirect('/auth/login');
      });
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      tenantId: user.tenantId ?? null,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      phone: user.phone ?? null,
      avatarUrl: user.avatarUrl ?? null,
    };

    // Make user available in all EJS templates
    res.locals.currentUser = req.user;
    res.locals.isAuthenticated = true;

    next();
  } catch (error) {
    authLogger.error('Authentication middleware error', { error: String(error) });
    next(error);
  }
}

/**
 * Optional auth - attaches user if session exists but doesn't block.
 * Useful for pages that show different content for logged-in vs anonymous users.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.session?.userId;

    if (userId) {
      const user = await UserModel.findById(userId);

      if (user && user.isActive) {
        req.user = {
          id: user.id,
          tenantId: user.tenantId ?? null,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          phone: user.phone ?? null,
          avatarUrl: user.avatarUrl ?? null,
        };
        res.locals.currentUser = req.user;
        res.locals.isAuthenticated = true;
      }
    }

    res.locals.isAuthenticated = res.locals.isAuthenticated || false;
    next();
  } catch {
    next();
  }
}

/**
 * Redirect if already authenticated (for login/register pages).
 */
export function redirectIfAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.userId) {
    res.redirect('/dashboard');
    return;
  }
  next();
}
