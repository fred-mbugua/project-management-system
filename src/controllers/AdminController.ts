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
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { formatKES } from '../utils/taxCalculator';
import subscriptionBillingService from '../services/subscriptionBilling.service';
import PlatformPaymentSettingsModel from '../models/platformSettings.model';
import logger from '../utils/logger';

const adminLogger = logger.child('AdminController');

export class AdminController {
  /**
   * List all registered organizations with pagination, search, and date filters
   */
  listTenants = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = extractPaginationParams(req, 10);
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (params.search) {
        conditions.push(`(
          t.name ILIKE $${paramIdx} OR
          t.slug ILIKE $${paramIdx} OR
          t.email ILIKE $${paramIdx} OR
          t.kra_pin ILIKE $${paramIdx} OR
          t.city ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`t.created_at >= $${paramIdx++}::timestamptz`);
        values.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        conditions.push(`t.created_at <= $${paramIdx++}::timestamptz`);
        values.push(`${params.endDate}T23:59:59Z`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countSql = `SELECT COUNT(*)::int as total FROM tenants t ${whereClause}`;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

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
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];
      const [result, plansRes] = await Promise.all([
        query(sql, dataValues),
        query(`SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY monthly_price ASC`),
      ]);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/admin/tenants', {
        title: 'Organizations',
        tenants: result.rows,
        plans: plansRes.rows,
        pagination,
        filters: params,
        formatKES,
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

  /**
   * Create a new subscription plan with frequency and custom interval
   */
  createPlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        name,
        tier,
        price,
        frequency,
        intervalMonths,
        annualPrice,
        maxUsers,
        maxProjects,
        maxStorageMb,
        description,
      } = req.body;

      if (!name || !name.trim() || price === undefined || price === '') {
        req.flash('error', 'Plan name and price are required.');
        res.redirect('/admin/plans');
        return;
      }

      const parsedPrice = parseFloat(price) || 0;
      const parsedInterval = parseInt(intervalMonths, 10) || 1;
      const planFrequency = frequency || 'MONTHLY';

      // Normalize monthly price for legacy comparisons
      let monthlyPrice = parsedPrice;
      if (planFrequency === 'QUARTERLY') monthlyPrice = parsedPrice / 3;
      else if (planFrequency === 'BIANNUAL') monthlyPrice = parsedPrice / 6;
      else if (planFrequency === 'ANNUAL') monthlyPrice = parsedPrice / 12;
      else if (planFrequency === 'CUSTOM' && parsedInterval > 0) monthlyPrice = parsedPrice / parsedInterval;

      const planTier = (tier && Object.values(SubscriptionTier).includes(tier)) ? tier : SubscriptionTier.STARTER;

      await SubscriptionModel.createPlan({
        name: name.trim(),
        tier: planTier,
        monthlyPrice,
        annualPrice: parseFloat(annualPrice) || (monthlyPrice * 12 * 0.85),
        price: parsedPrice,
        frequency: planFrequency,
        intervalMonths: parsedInterval,
        description: description ? description.trim() : null,
        maxUsers: parseInt(maxUsers, 10) || 5,
        maxProjects: parseInt(maxProjects, 10) || 10,
        maxStorageMb: parseInt(maxStorageMb, 10) || 1000,
        isActive: true,
      });

      await AuditLogModel.create({
        userId: req.user?.id,
        action: AuditAction.CREATE,
        entityType: 'SubscriptionPlan',
        description: `Created subscription plan "${name.trim()}" (${planFrequency} - KES ${parsedPrice.toLocaleString()})`,
      });

      req.flash('success', `Subscription plan "${name.trim()}" created successfully.`);
      res.redirect('/admin/plans');
    } catch (error) {
      adminLogger.error('Failed to create subscription plan', { error: String(error) });
      req.flash('error', 'Failed to create plan: ' + (error instanceof Error ? error.message : String(error)));
      res.redirect('/admin/plans');
    }
  };

  /**
   * Update an existing subscription plan
   */
  updatePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const planId = req.params.id as string;
      const {
        name,
        tier,
        price,
        frequency,
        intervalMonths,
        annualPrice,
        maxUsers,
        maxProjects,
        maxStorageMb,
        description,
      } = req.body;

      if (!name || !name.trim() || price === undefined || price === '') {
        req.flash('error', 'Plan name and price are required.');
        res.redirect('/admin/plans');
        return;
      }

      const parsedPrice = parseFloat(price) || 0;
      const parsedInterval = parseInt(intervalMonths, 10) || 1;
      const planFrequency = frequency || 'MONTHLY';

      let monthlyPrice = parsedPrice;
      if (planFrequency === 'QUARTERLY') monthlyPrice = parsedPrice / 3;
      else if (planFrequency === 'BIANNUAL') monthlyPrice = parsedPrice / 6;
      else if (planFrequency === 'ANNUAL') monthlyPrice = parsedPrice / 12;
      else if (planFrequency === 'CUSTOM' && parsedInterval > 0) monthlyPrice = parsedPrice / parsedInterval;

      const calculatedAnnualPrice = parseFloat(annualPrice) || (monthlyPrice * 12 * 0.85);
      const planTier = (tier && Object.values(SubscriptionTier).includes(tier)) ? tier : null;

      await query(`
        UPDATE subscription_plans
        SET name = COALESCE($1, name),
            tier = COALESCE($2, tier),
            price = $3,
            monthly_price = $4,
            annual_price = $5,
            frequency = COALESCE($6, frequency),
            interval_months = $7,
            max_users = COALESCE($8, max_users),
            max_projects = COALESCE($9, max_projects),
            max_storage_mb = COALESCE($10, max_storage_mb),
            description = COALESCE($11, description),
            updated_at = NOW()
        WHERE id = $12
      `, [
        name.trim() || null,
        planTier,
        parsedPrice,
        monthlyPrice,
        calculatedAnnualPrice,
        planFrequency || null,
        parsedInterval,
        maxUsers ? parseInt(maxUsers, 10) : null,
        maxProjects ? parseInt(maxProjects, 10) : null,
        maxStorageMb ? parseInt(maxStorageMb, 10) : null,
        description ? description.trim() : null,
        planId,
      ]);

      await AuditLogModel.create({
        userId: req.user?.id,
        action: AuditAction.UPDATE,
        entityType: 'SubscriptionPlan',
        entityId: planId,
        description: `Updated subscription plan "${name.trim()}" (${planFrequency} - KES ${parsedPrice.toLocaleString()})`,
      });

      req.flash('success', `Subscription plan "${name.trim()}" updated successfully.`);
      res.redirect('/admin/plans');
    } catch (error) {
      adminLogger.error('Failed to update plan', { error: String(error) });
      req.flash('error', 'Failed to update plan: ' + (error instanceof Error ? error.message : String(error)));
      res.redirect('/admin/plans');
    }
  };

  /**
   * Toggle Plan Active / Inactive Status
   */
  togglePlanStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const planId = req.params.id as string;
      await query(`UPDATE subscription_plans SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1`, [planId]);
      req.flash('success', 'Plan status updated.');
      res.redirect('/admin/plans');
    } catch (error) {
      next(error);
    }
  };

  /**
   * Suspend a tenant account manually
   */
  suspendTenant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.id as string;

      const tenantRes = await query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
      const tenant = tenantRes.rows[0];
      if (!tenant) {
        req.flash('error', 'Organization not found.');
        res.redirect('/admin/tenants');
        return;
      }

      await withTransaction(async (client) => {
        // Deactivate workspace
        await client.query(`UPDATE tenants SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [tenantId]);
        // Update subscription status to SUSPENDED
        await client.query(`UPDATE tenant_subscriptions SET status = 'SUSPENDED', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
        // Audit log
        await client.query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, description, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'UPDATE', 'Tenant', $1, $3, NOW())`,
          [tenantId, req.user?.id, `Super Admin suspended organization "${tenant.name}"`]
        );
      });

      req.flash('success', `Organization "${tenant.name}" has been suspended.`);
      res.redirect('/admin/tenants');
    } catch (error) {
      adminLogger.error('Failed to suspend tenant', { error: String(error) });
      next(error);
    }
  };

  /**
   * Activate a tenant account manually
   */
  activateTenant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.id as string;

      const tenantRes = await query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
      const tenant = tenantRes.rows[0];
      if (!tenant) {
        req.flash('error', 'Organization not found.');
        res.redirect('/admin/tenants');
        return;
      }

      await withTransaction(async (client) => {
        // Activate workspace
        await client.query(`UPDATE tenants SET is_active = TRUE, updated_at = NOW() WHERE id = $1`, [tenantId]);
        // Update subscription status to ACTIVE
        await client.query(`UPDATE tenant_subscriptions SET status = 'ACTIVE', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
        // Audit log
        await client.query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, description, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'UPDATE', 'Tenant', $1, $3, NOW())`,
          [tenantId, req.user?.id, `Super Admin activated organization "${tenant.name}"`]
        );
      });

      req.flash('success', `Organization "${tenant.name}" has been activated.`);
      res.redirect('/admin/tenants');
    } catch (error) {
      adminLogger.error('Failed to activate tenant', { error: String(error) });
      next(error);
    }
  };

  /**
   * Toggle Subscription Fee Whitelist (Exemption) for an Organization
   * When whitelisted, account does not pay subscription fees and bypasses expiration locks.
   */
  toggleTenantWhitelist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.id as string;

      const tenantRes = await query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
      const tenant = tenantRes.rows[0];
      if (!tenant) {
        req.flash('error', 'Organization not found.');
        res.redirect('/admin/tenants');
        return;
      }

      const newExemptStatus = !Boolean(tenant.subscription_exempt);

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE tenants SET subscription_exempt = $1, updated_at = NOW() WHERE id = $2`,
          [newExemptStatus, tenantId]
        );

        // If whitelisted, ensure tenant and subscription are active
        if (newExemptStatus) {
          await client.query(`UPDATE tenants SET is_active = TRUE, updated_at = NOW() WHERE id = $1`, [tenantId]);
          await client.query(
            `UPDATE tenant_subscriptions SET status = 'ACTIVE', updated_at = NOW() WHERE tenant_id = $1`,
            [tenantId]
          );
        }

        await client.query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, description, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'UPDATE', 'Tenant', $1, $3, NOW())`,
          [
            tenantId,
            req.user?.id,
            newExemptStatus
              ? `Super Admin whitelisted organization "${tenant.name}" from paying subscription fees (Complimentary Exemption).`
              : `Super Admin revoked subscription fee whitelist for organization "${tenant.name}".`,
          ]
        );
      });

      req.flash(
        'success',
        newExemptStatus
          ? `Organization "${tenant.name}" is now WHITELISTED from paying subscription fees.`
          : `Subscription fee whitelist removed for organization "${tenant.name}". Account will be billed normally.`
      );
      res.redirect('/admin/tenants');
    } catch (error) {
      adminLogger.error('Failed to toggle tenant whitelist', { error: String(error) });
      next(error);
    }
  };

  /**
   * Change or update tenant subscription package
   */
  updateTenantSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.id as string;
      const { planId, extendMonths } = req.body;

      if (!planId) {
        req.flash('error', 'Plan selection is required.');
        res.redirect('/admin/tenants');
        return;
      }

      const months = parseInt(extendMonths, 10) || 1;
      const newEnd = new Date();
      newEnd.setMonth(newEnd.getMonth() + months);

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE tenant_subscriptions 
           SET plan_id = $1, status = 'ACTIVE', current_period_end = $2, updated_at = NOW()
           WHERE tenant_id = $3`,
          [planId, newEnd, tenantId]
        );
        await client.query(
          `UPDATE tenants SET is_active = TRUE, updated_at = NOW() WHERE id = $1`,
          [tenantId]
        );
      });

      req.flash('success', 'Organization subscription package updated and activated.');
      res.redirect('/admin/tenants');
    } catch (error) {
      adminLogger.error('Failed to update tenant subscription', { error: String(error) });
      next(error);
    }
  };

  /**
   * Trigger subscription expiration scan and enforcement on-demand
   */
  scanSubscriptions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const remindersResult = await subscriptionBillingService.checkAndSendExpiringReminders();
      const expirationResult = await subscriptionBillingService.checkAndEnforceExpiredSubscriptions();
      req.flash(
        'success',
        `Subscription Scan Complete: Sent ${remindersResult.remindersSent} daily 3-day reminder(s). Scanned ${expirationResult.totalScanned} account(s), deactivated ${expirationResult.totalDeactivated} expired, issued ${expirationResult.invoicesGenerated} renewal invoice(s).`
      );
      res.redirect('/admin/tenants');
    } catch (error) {
      adminLogger.error('Failed to scan subscriptions', { error: String(error) });
      next(error);
    }
  };

  /**
   * Get Platform Payment Gateways & Subscription Payment Methods Configuration
   */
  getPaymentSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const settings = await PlatformPaymentSettingsModel.getSettings();
      res.render('pages/admin/payment-settings', {
        title: 'Platform Payment Gateways',
        settings,
      });
    } catch (error) {
      adminLogger.error('Failed to load platform payment settings', { error: String(error) });
      next(error);
    }
  };

  /**
   * Update Platform Payment Gateways & Subscription Payment Methods Configuration
   */
  updatePaymentSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = req.body || {};
      const {
        mpesaEnabled,
        mpesaEnvironment,
        mpesaShortcode,
        mpesaShortcodeType,
        mpesaConsumerKey,
        mpesaConsumerSecret,
        mpesaPasskey,
        cardEnabled,
        cardProvider,
        cardPublicKey,
        cardSecretKey,
        bankEnabled,
        bankName,
        bankAccountName,
        bankAccountNumber,
        bankInstructions,
        manualPesaEnabled,
      } = body;

      await PlatformPaymentSettingsModel.updateSettings({
        mpesaEnabled: mpesaEnabled === 'on' || mpesaEnabled === '1' || mpesaEnabled === 'true' || mpesaEnabled === true,
        mpesaEnvironment: mpesaEnvironment || 'production',
        mpesaShortcode: mpesaShortcode || '4814641',
        mpesaShortcodeType: mpesaShortcodeType || 'PAYBILL',
        mpesaConsumerKey: mpesaConsumerKey ? mpesaConsumerKey.trim() : '',
        mpesaConsumerSecret: mpesaConsumerSecret ? mpesaConsumerSecret.trim() : '',
        mpesaPasskey: mpesaPasskey ? mpesaPasskey.trim() : '',
        cardEnabled: cardEnabled === 'on' || cardEnabled === '1' || cardEnabled === 'true' || cardEnabled === true,
        cardProvider: cardProvider || 'STRIPE',
        cardPublicKey: cardPublicKey ? cardPublicKey.trim() : '',
        cardSecretKey: cardSecretKey ? cardSecretKey.trim() : '',
        bankEnabled: bankEnabled === 'on' || bankEnabled === '1' || bankEnabled === 'true' || bankEnabled === true,
        bankName: bankName ? bankName.trim() : '',
        bankAccountName: bankAccountName ? bankAccountName.trim() : '',
        bankAccountNumber: bankAccountNumber ? bankAccountNumber.trim() : '',
        bankInstructions: bankInstructions ? bankInstructions.trim() : '',
        manualPesaEnabled: manualPesaEnabled === 'on' || manualPesaEnabled === '1' || manualPesaEnabled === 'true' || manualPesaEnabled === true,
      });

      req.flash('success', 'Platform payment gateways and subscription payment methods updated successfully.');
      res.redirect('/admin/payment-settings');
    } catch (error) {
      adminLogger.error('Failed to update platform payment settings', { error: String(error) });
      next(error);
    }
  };
}

export default new AdminController();

