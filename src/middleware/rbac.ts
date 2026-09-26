// ══════════════════════════════════════════════════════════════════════
// Role-Based Access Control (RBAC) Middleware
// Guards routes based on user roles with hierarchical permissions
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../models/types';
import logger from '../utils/logger';

const rbacLogger = logger.child('RBAC');

/**
 * Role hierarchy for permission checks.
 * Higher numbers = more permissions.
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  TENANT_OWNER: 90,
  PROJECT_MANAGER: 70,
  ACCOUNTANT: 60,
  TEAM_MEMBER: 30,
  CLIENT_PORTAL: 10,
};

/**
 * Guard that restricts access to users with one of the specified roles.
 * Usage: router.get('/admin', requireRole('SUPER_ADMIN', 'TENANT_OWNER'), controller.admin)
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role as UserRole | undefined;

    if (!userRole) {
      rbacLogger.warn('RBAC check failed: no user role', { path: req.path });
      req.flash('error', 'Authentication required.');
      res.redirect('/auth/login');
      return;
    }

    if (!allowedRoles.includes(userRole)) {
      rbacLogger.warn('RBAC access denied', {
        userId: req.user?.id,
        role: userRole,
        requiredRoles: allowedRoles,
        path: req.path,
      });

      // Return 403 for API requests, render error page for browser requests
      if (req.path.startsWith('/api/')) {
        res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to access this resource.',
        });
        return;
      }

      req.flash('error', 'You do not have permission to access this page.');
      res.redirect('/dashboard');
      return;
    }

    next();
  };
}

/**
 * Guard that restricts access to users at or above a minimum role level.
 * Uses the role hierarchy for flexible permission checking.
 * Usage: router.get('/reports', requireMinRole('ACCOUNTANT'), controller.reports)
 */
export function requireMinRole(minimumRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role as UserRole | undefined;

    if (!userRole) {
      req.flash('error', 'Authentication required.');
      res.redirect('/auth/login');
      return;
    }

    const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

    if (userLevel < requiredLevel) {
      rbacLogger.warn('RBAC minimum role check failed', {
        userId: req.user?.id,
        userRole,
        minimumRole,
        path: req.path,
      });

      if (req.path.startsWith('/api/')) {
        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      req.flash('error', 'You do not have permission to access this page.');
      res.redirect('/dashboard');
      return;
    }

    next();
  };
}

/**
 * Super Admin only guard.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'SUPER_ADMIN') {
    rbacLogger.warn('Super Admin access denied', {
      userId: req.user?.id,
      role: req.user?.role,
      path: req.path,
    });
    res.status(403).render('pages/errors/403', {
      title: 'Access Denied',
      message: 'This area is restricted to platform administrators.',
    });
    return;
  }
  next();
}
