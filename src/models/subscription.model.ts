// ══════════════════════════════════════════════════════════════════════
// Subscription Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import {
  SubscriptionPlan,
  TenantSubscription,
  SubscriptionTier,
  SubscriptionStatus,
} from './types';

export interface CreateSubscriptionPlanInput {
  id?: string;
  name: string;
  tier: SubscriptionTier;
  monthlyPrice: number;
  annualPrice: number;
  maxUsers: number;
  maxProjects: number;
  maxStorageMb?: number;
  features?: Record<string, any> | null;
  isActive?: boolean;
}

export interface CreateTenantSubscriptionInput {
  id?: string;
  tenantId: string;
  planId: string;
  status?: SubscriptionStatus;
  billingCycle?: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  autoRenew?: boolean;
  mpesaReceiptNo?: string | null;
}

export class SubscriptionModel {
  private static mapPlanRow(row: any): SubscriptionPlan {
    return {
      id: row.id,
      name: row.name,
      tier: row.tier,
      monthlyPrice: parseFloat(row.monthly_price),
      annualPrice: parseFloat(row.annual_price),
      maxUsers: row.max_users,
      maxProjects: row.max_projects,
      maxStorageMb: row.max_storage_mb,
      features: row.features,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private static mapSubscriptionRow(row: any): TenantSubscription {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      planId: row.plan_id,
      status: row.status,
      billingCycle: row.billing_cycle,
      currentPeriodStart: new Date(row.current_period_start),
      currentPeriodEnd: new Date(row.current_period_end),
      autoRenew: row.auto_renew,
      mpesaReceiptNo: row.mpesa_receipt_no,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Find subscription plan by Tier
   */
  static async findPlanByTier(
    tier: SubscriptionTier,
    client?: PoolClient
  ): Promise<SubscriptionPlan | null> {
    const sql = `
      SELECT * FROM subscription_plans
      WHERE tier = $1 AND is_active = TRUE
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tier]);
    return res.rows[0] ? this.mapPlanRow(res.rows[0]) : null;
  }

  /**
   * Find subscription plan by ID
   */
  static async findPlanById(id: string, client?: PoolClient): Promise<SubscriptionPlan | null> {
    const sql = `
      SELECT * FROM subscription_plans
      WHERE id = $1
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapPlanRow(res.rows[0]) : null;
  }

  /**
   * Create a subscription plan
   */
  static async createPlan(
    data: CreateSubscriptionPlanInput,
    client?: PoolClient
  ): Promise<SubscriptionPlan> {
    const sql = `
      INSERT INTO subscription_plans (
        id, name, tier, monthly_price, annual_price,
        max_users, max_projects, max_storage_mb, features, is_active, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.name,
      data.tier,
      data.monthlyPrice,
      data.annualPrice,
      data.maxUsers,
      data.maxProjects,
      data.maxStorageMb ?? 500,
      data.features ? JSON.stringify(data.features) : null,
      data.isActive ?? true,
    ];

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapPlanRow(res.rows[0]);
  }

  /**
   * Upsert subscription plan (for seeds)
   */
  static async upsertPlan(
    data: CreateSubscriptionPlanInput,
    client?: PoolClient
  ): Promise<SubscriptionPlan> {
    if (data.id) {
      const existing = await this.findPlanById(data.id, client);
      if (existing) return existing;
    }
    return await this.createPlan(data, client);
  }

  /**
   * Create a tenant subscription
   */
  static async createTenantSubscription(
    data: CreateTenantSubscriptionInput,
    client?: PoolClient
  ): Promise<TenantSubscription> {
    const sql = `
      INSERT INTO tenant_subscriptions (
        id, tenant_id, plan_id, status, billing_cycle,
        current_period_start, current_period_end, auto_renew, mpesa_receipt_no, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.planId,
      data.status || SubscriptionStatus.TRIAL,
      data.billingCycle || 'monthly',
      data.currentPeriodStart,
      data.currentPeriodEnd,
      data.autoRenew ?? true,
      data.mpesaReceiptNo || null,
    ];

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapSubscriptionRow(res.rows[0]);
  }

  /**
   * Find subscription by tenant ID
   */
  static async findByTenantId(
    tenantId: string,
    client?: PoolClient
  ): Promise<TenantSubscription | null> {
    const sql = `
      SELECT * FROM tenant_subscriptions
      WHERE tenant_id = $1
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId]);
    return res.rows[0] ? this.mapSubscriptionRow(res.rows[0]) : null;
  }

  /**
   * Upsert tenant subscription (for seeds)
   */
  static async upsertTenantSubscription(
    data: CreateTenantSubscriptionInput,
    client?: PoolClient
  ): Promise<TenantSubscription> {
    const existing = await this.findByTenantId(data.tenantId, client);
    if (existing) return existing;
    return await this.createTenantSubscription(data, client);
  }
}
