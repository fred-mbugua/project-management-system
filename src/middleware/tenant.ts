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

    if (!tenant) {
      tenantLogger.error('Tenant not found', { tenantId });
      req.flash('error', 'Your organization account could not be found.');
      req.session.destroy(() => {
        res.redirect('/auth/login');
      });
      return;
    }

    // Query tenant subscription status
    const subRes = await query(
      `SELECT ts.*, sp.name as plan_name, sp.tier as plan_tier 
       FROM tenant_subscriptions ts 
       LEFT JOIN subscription_plans sp ON ts.plan_id = sp.id 
       WHERE ts.tenant_id = $1 LIMIT 1`,
      [tenantId]
    );

    const subscription = subRes.rows[0] || null;
    const isExempt = Boolean(tenant.subscriptionExempt);
    const isCancelled = Boolean(
      !isExempt &&
      subscription && (
        subscription.status === 'CANCELLED' || subscription.status === 'CANCELED'
      )
    );
    const isSubscriptionExpired = Boolean(
      !isExempt &&
      !isCancelled &&
      subscription && (
        subscription.status === 'EXPIRED' ||
        (subscription.current_period_end && new Date(subscription.current_period_end) < new Date())
      )
    );

    // Attach tenant context to request & templates
    req.tenantId = tenant.id;
    req.tenant = tenant;
    res.locals.tenant = tenant;
    res.locals.isSuperAdmin = false;
    res.locals.subscription = subscription;
    res.locals.isSubscriptionExpired = isSubscriptionExpired;
    res.locals.isSubscriptionCancelled = isCancelled;
    res.locals.subscriptionExempt = isExempt;
    (req as any).isSubscriptionCancelled = isCancelled;
    (req as any).subscriptionExempt = isExempt;

    // If subscription is expired or tenant is marked inactive
    if (!isExempt && (isSubscriptionExpired || !tenant.isActive)) {
      // If tenant was suspended manually by Super Admin (not expired subscription)
      if (!isSubscriptionExpired && !tenant.isActive) {
        tenantLogger.warn('Tenant suspended by administrator', { tenantId });
        req.flash('error', 'Your organization account has been suspended by the platform administrator.');
        req.session.destroy(() => {
          res.redirect('/auth/login');
        });
        return;
      }

      // If subscription is expired:
      // Whitelist routes that allow viewing subscription details, initiating payment, verifying payment, or logging out
      const originalPath = req.originalUrl.split('?')[0];
      const isSubscriptionRoute = originalPath.startsWith('/subscription') || originalPath === '/auth/logout';

      if (isSubscriptionRoute) {
        next();
        return;
      }

      // Any other page in the portal -> redirect to subscription payment page!
      req.flash('warning', 'Your subscription has expired. Please settle your renewal invoice to restore full access.');
      res.redirect('/subscription/pay');
      return;
    }

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
