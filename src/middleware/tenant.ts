// ══════════════════════════════════════════════════════════════════════
// Tenant Isolation Middleware
// Resolves tenant context and enforces strict row-level scoping
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { TenantModel } from '../models/tenant.model';
import { query } from '../config/database';
import logger from '../utils/logger';

const tenantLogger = logger.child('Tenant');

/**
 * Resolve tenant context from the authenticated user's session.
 * Attaches tenantId and tenant branding info to the request.
 * SUPER_ADMIN users bypass tenant scoping but have a default tenant context for operational views.
 */
export async function resolveTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Super Admins operate at platform level - resolve effective or fallback tenant
    if (req.user?.role === 'SUPER_ADMIN') {
      res.locals.isSuperAdmin = true;
      let effectiveTenantId = (req.query.tenantId as string) || ((req.session as any)?.activeTenantId as string);
      let tenant = null;
      if (effectiveTenantId) {
        tenant = await TenantModel.findById(effectiveTenantId);
      }
      if (!tenant) {
        const firstTenantRes = await query('SELECT id FROM tenants WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
        if (firstTenantRes.rows.length > 0) {
          tenant = await TenantModel.findById(firstTenantRes.rows[0].id);
        }
      }
      if (tenant) {
        req.tenantId = tenant.id;
        req.tenant = tenant;
        res.locals.tenant = tenant;
      } else {
        req.tenantId = undefined;
        req.tenant = undefined;
        res.locals.tenant = null;
      }
      next();
      return;
    }

    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      tenantLogger.warn('No tenant context for non-super-admin user', {
        userId: req.user?.id,
        role: req.user?.role,
      });
      req.flash('error', 'Your account is not associated with any organization.');
      res.redirect('/auth/login');
      return;
    }

    const tenant = await TenantModel.findById(tenantId);

    if (!tenant || !tenant.isActive) {
      tenantLogger.error('Tenant not found or inactive', { tenantId });
      req.flash('error', 'Your organization account has been deactivated.');
      req.session.destroy(() => {
        res.redirect('/auth/login');
      });
      return;
    }

    // Attach tenant context to request
    req.tenantId = tenant.id;
    req.tenant = tenant;

    // Make tenant available in all EJS templates
    res.locals.tenant = tenant;
    res.locals.isSuperAdmin = false;

    next();
  } catch (error) {
    tenantLogger.error('Tenant resolution error', { error: String(error) });
    next(error);
  }
}

/**
 * Guard that ensures a valid tenant context exists on the request.
 * Use this on any route that performs tenant-scoped database operations.
 */
export function requireTenantContext(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role === 'SUPER_ADMIN') {
    next();
    return;
  }

  if (!req.tenantId) {
    tenantLogger.error('Missing tenant context on protected route', {
      path: req.path,
      userId: req.user?.id,
    });
    res.status(403).json({ error: 'Tenant context required' });
    return;
  }

  next();
}
