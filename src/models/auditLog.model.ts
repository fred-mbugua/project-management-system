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
}
