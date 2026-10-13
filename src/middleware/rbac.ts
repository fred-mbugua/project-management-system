// ══════════════════════════════════════════════════════════════════════
// Role-Based Access Control (RBAC) Middleware
// Guards routes based on user roles with hierarchical permissions
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { UserRole, UserModulePermissions, PermissionLevel, User } from '../models/types';
import logger from '../utils/logger';

const rbacLogger = logger.child('RBAC');

/**
 * Default preset permissions templates by role.
 * Used when creating new users or as fallback for existing users without custom overrides.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, UserModulePermissions> = {
  [UserRole.SUPER_ADMIN]: {
    projects: 'manage',
    calendar: 'manage',
    maintenance: 'manage',
    quotations: 'manage',
    invoices: 'manage',
    expenses: 'manage',
    accounting: 'manage',
    team: 'manage',
    clients: 'manage',
    settings: 'manage',
    audit_logs: 'manage',
  },
  [UserRole.TENANT_OWNER]: {
    projects: 'manage',
    calendar: 'manage',
    maintenance: 'manage',
    quotations: 'manage',
    invoices: 'manage',
    expenses: 'manage',
    accounting: 'manage',
    team: 'manage',
    clients: 'manage',
    settings: 'manage',
    audit_logs: 'manage',
  },
  [UserRole.PROJECT_MANAGER]: {
    projects: 'manage',
    calendar: 'manage',
    maintenance: 'manage',
    quotations: 'manage',
    invoices: 'view',
    expenses: 'manage',
    accounting: 'none',
    team: 'manage',
    clients: 'manage',
    settings: 'none',
    audit_logs: 'none',
  },
  [UserRole.ACCOUNTANT]: {
    projects: 'view',
    calendar: 'view',
    maintenance: 'view',
    quotations: 'manage',
    invoices: 'manage',
    expenses: 'manage',
    accounting: 'manage',
    team: 'none',
    clients: 'manage',
    settings: 'none',
    audit_logs: 'none',
  },
  [UserRole.TEAM_MEMBER]: {
    projects: 'view',
    calendar: 'view',
    maintenance: 'none',
    quotations: 'none',
    invoices: 'none',
    expenses: 'none',
    accounting: 'none',
    team: 'none',
    clients: 'none',
    settings: 'none',
    audit_logs: 'none',
  },
  [UserRole.CLIENT_PORTAL]: {
    projects: 'view',
    calendar: 'none',
    maintenance: 'none',
    quotations: 'none',
    invoices: 'view',
    expenses: 'none',
    accounting: 'none',
    team: 'none',
    clients: 'none',
    settings: 'none',
    audit_logs: 'none',
  },
};

/**
 * Resolves a user's active permissions, merging role defaults with any custom overrides.
 */
export function resolveUserPermissions(
  role: UserRole,
  customPermissions?: Partial<UserModulePermissions> | null
): UserModulePermissions {
  const defaults = DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS[UserRole.TEAM_MEMBER];
  if (!customPermissions || typeof customPermissions !== 'object') {
    return { ...defaults };
  }
  return {
    projects: customPermissions.projects || defaults.projects,
    calendar: customPermissions.calendar || defaults.calendar,
    maintenance: customPermissions.maintenance || defaults.maintenance,
    quotations: customPermissions.quotations || defaults.quotations,
    invoices: customPermissions.invoices || defaults.invoices,
    expenses: customPermissions.expenses || defaults.expenses,
    accounting: customPermissions.accounting || defaults.accounting,
    team: customPermissions.team || defaults.team,
    clients: customPermissions.clients || defaults.clients,
    settings: customPermissions.settings || defaults.settings,
    audit_logs: customPermissions.audit_logs || defaults.audit_logs,
  };
}

/**
 * Check whether a user has permission to view or manage a specific module.
 */
export function hasModulePermission(
  user: Express.User | User | undefined | null,
  moduleName: keyof UserModulePermissions,
  requiredLevel: 'view' | 'manage' = 'view'
): boolean {
  if (!user) return false;
  if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.TENANT_OWNER) {
    return true;
  }

  const permissions = user.permissions || resolveUserPermissions(user.role);
  const currentLevel: PermissionLevel = permissions[moduleName] || 'none';

  if (currentLevel === 'none') {
    return false;
  }

  if (requiredLevel === 'view') {
    return currentLevel === 'view' || currentLevel === 'manage';
  }

  return currentLevel === 'manage';
}

/**
 * Check whether a user is restricted to assigned projects only.
 */
export function isAssignedProjectsOnly(user: Express.User | User | undefined | null): boolean {
  if (!user) return false;
  if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.TENANT_OWNER) {
    return false;
  }
  return user.projectScope === 'ASSIGNED';
}

/**
 * Guard routes by module permission level ('view' vs 'manage').
 * Usage: router.get('/invoices', requireModuleAccess('invoices', 'view'), invoiceController.index)
 *        router.post('/invoices/new', requireModuleAccess('invoices', 'manage'), invoiceController.create)
 */
export function requireModuleAccess(
  moduleName: keyof UserModulePermissions,
  requiredLevel: 'view' | 'manage' = 'view'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      rbacLogger.warn('Module access check failed: unauthenticated', { path: req.path });
      req.flash('error', 'Authentication required.');
      res.redirect('/auth/login');
      return;
    }

    if (!hasModulePermission(user, moduleName, requiredLevel)) {
      rbacLogger.warn('Module access denied', {
        userId: user.id,
        role: user.role,
        moduleName,
        requiredLevel,
        path: req.path,
      });

      const message = requiredLevel === 'manage'
        ? `You do not have permission to manage the ${moduleName.replace(/_/g, ' ')} area.`
        : `You do not have permission to access the ${moduleName.replace(/_/g, ' ')} module.`;

      if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
        res.status(403).json({ error: 'Access denied', message });
        return;
      }

      req.flash('error', message);
      res.redirect('/dashboard');
      return;
    }

    next();
  };
}

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
