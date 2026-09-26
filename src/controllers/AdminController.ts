// ══════════════════════════════════════════════════════════════════════
// Admin Controller - Raw PostgreSQL Queries
// Platform management for Super Administrators
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/database';
import {
  TenantModel,
  UserModel,
  SubscriptionModel,
  AuditLogModel,
  UserRole,
  SubscriptionTier,
  SubscriptionStatus,
  AuditAction,
} from '../models';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const adminLogger = logger.child('AdminController');

export class AdminController {
  /**
   * List all registered organizations
   */
  listTenants = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sql = `
        SELECT 
          t.*,
          sp.name as plan_name,
          sp.tier as plan_tier,
          ts.status as subscription_status,
          (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) as user_count,
          (SELECT COUNT(*)::int FROM projects p WHERE p.tenant_id = t.id) as project_count
        FROM tenants t
        LEFT JOIN tenant_subscriptions ts ON t.id = ts.tenant_id
        LEFT JOIN subscription_plans sp ON ts.plan_id = sp.id
        ORDER BY t.created_at DESC
      `;
      const result = await query(sql);

      res.render('pages/admin/tenants', {
        title: 'Organizations',
        tenants: result.rows,
      });
    } catch (error) {
      adminLogger.error('Failed to list tenants', { error: String(error) });
      next(error);
    }
  };

  /**
   * Show organization onboarding form
   */
  showNewTenant = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plansRes = await query(`SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY monthly_price ASC`);
      res.render('pages/admin/new-tenant', {
        title: 'Add Organization',
        plans: plansRes.rows,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Handle organization onboarding submission
   */
  handleCreateTenant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        companyName,
        email,
        phone,
        address,
        city,
        kraPin,
        planId,
        ownerFirstName,
        ownerLastName,
        ownerEmail,
        ownerPassword,
      } = req.body;

      if (!companyName || !email || !ownerEmail || !ownerPassword) {
        req.flash('error', 'Company name, organization email, owner email, and password are required.');
        res.redirect('/admin/tenants/new');
        return;
      }

      // Check owner email conflict
      const existingUser = await UserModel.findByEmail(ownerEmail);
      if (existingUser) {
        req.flash('error', 'A user with this owner email already exists.');
        res.redirect('/admin/tenants/new');
        return;
      }

      // Generate slug
      const slug = companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const existingTenant = await TenantModel.findBySlug(slug);
      const finalSlug = existingTenant ? `${slug}-${Date.now().toString(36)}` : slug;

      const passwordHash = await bcrypt.hash(ownerPassword, 12);

      await withTransaction(async (client) => {
        // Create Tenant
        const tenant = await TenantModel.create(
          {
            name: companyName,
            slug: finalSlug,
            email,
            phone: phone || null,
            address: address || null,
            city: city || null,
            kraPin: kraPin || null,
          },
          client
        );

        // Create Tenant Owner
        const user = await UserModel.create(
          {
            tenantId: tenant.id,
            email: ownerEmail,
            passwordHash,
            firstName: ownerFirstName || 'Organization',
            lastName: ownerLastName || 'Owner',
            role: UserRole.TENANT_OWNER,
            phone: phone || null,
          },
          client
        );

        // Assign Subscription Plan
        const selectedPlanId = planId || (await SubscriptionModel.findPlanByTier(SubscriptionTier.STARTER, client))?.id;
        if (selectedPlanId) {
          await SubscriptionModel.createTenantSubscription(
            {
              tenantId: tenant.id,
              planId: selectedPlanId,
              status: SubscriptionStatus.ACTIVE,
              billingCycle: 'monthly',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              autoRenew: true,
            },
            client
          );
        }

        // Audit Log
        await AuditLogModel.create(
          {
            tenantId: tenant.id,
            userId: req.user?.id,
            action: AuditAction.CREATE,
            entityType: 'Tenant',
            entityId: tenant.id,
            description: `Tenant "${companyName}" created by Super Admin`,
          },
          client
        );
      });

      req.flash('success', `Organization "${companyName}" created successfully.`);
      res.redirect('/admin/tenants');
    } catch (error) {
      adminLogger.error('Failed to create tenant', { error: String(error) });
      next(error);
    }
  };

  /**
   * List subscription plans
   */
  listPlans = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sql = `
        SELECT 
          sp.*,
          (SELECT COUNT(*)::int FROM tenant_subscriptions ts WHERE ts.plan_id = sp.id AND ts.status = 'ACTIVE') as active_count
        FROM subscription_plans sp
        ORDER BY monthly_price ASC
      `;
      const result = await query(sql);

      res.render('pages/admin/plans', {
        title: 'Subscription Plans',
        plans: result.rows,
        formatKES,
      });
    } catch (error) {
      next(error);
    }
  };
}

export default new AdminController();
