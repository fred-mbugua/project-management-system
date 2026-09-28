// ══════════════════════════════════════════════════════════════════════
// Audit Log Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { AuditLog, AuditAction } from './types';

export interface CreateAuditLogInput {
  id?: string;
  tenantId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  description: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: any;
}

export class AuditLogModel {
  private static mapRow(row: any): AuditLog {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      description: row.description,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Create an audit log record
   */
  static async create(data: CreateAuditLogInput, client?: PoolClient): Promise<AuditLog> {
    const sql = `
      INSERT INTO audit_logs (
        id, tenant_id, user_id, action, entity_type,
        entity_id, description, ip_address, user_agent, metadata, created_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId || null,
      data.userId || null,
      data.action,
      data.entityType,
      data.entityId || null,
      data.description,
      data.ipAddress || null,
      data.userAgent || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ];

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  /**
   * Find audit logs for a tenant
   */
  static async findByTenant(
    tenantId: string,
    limit: number = 50,
    client?: PoolClient
  ): Promise<AuditLog[]> {
    const sql = `
      SELECT * FROM audit_logs
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId, limit]);
    return res.rows.map(this.mapRow);
  }

  /**
   * Find audit logs with user details for display tables
   */
  static async findWithUser(options: {
    tenantId?: string | null;
    action?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<any[]> {
    const { tenantId, action, limit = 50, offset = 0 } = options;
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (tenantId) {
      conditions.push(`a.tenant_id = $${paramIdx++}`);
      values.push(tenantId);
    }

    if (action) {
      conditions.push(`a.action = $${paramIdx++}`);
      values.push(action);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT a.*, 
             u.first_name, u.last_name, u.email as user_email, u.role as user_role,
             t.name as tenant_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN tenants t ON a.tenant_id = t.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    values.push(limit, offset);

    const res = await query(sql, values);
    return res.rows.map((row: any) => ({
      ...this.mapRow(row),
      userName: row.first_name ? `${row.first_name} ${row.last_name}` : 'System',
      userEmail: row.user_email,
      userRole: row.user_role,
      tenantName: row.tenant_name,
    }));
  }

  /**
   * Count audit logs with optional filters
   */
  static async count(options: {
    tenantId?: string | null;
    action?: string;
  } = {}): Promise<number> {
    const { tenantId, action } = options;
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (tenantId) {
      conditions.push(`tenant_id = $${paramIdx++}`);
      values.push(tenantId);
    }

    if (action) {
      conditions.push(`action = $${paramIdx++}`);
      values.push(action);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) FROM audit_logs ${whereClause}`;
    const res = await query(sql, values);
    return parseInt(res.rows[0].count, 10);
  }
}
