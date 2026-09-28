// ══════════════════════════════════════════════════════════════════════
// Error Log Model - Raw PostgreSQL Queries
// Persistent Diagnostic Records for System & Application Errors
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';

export interface ErrorLog {
  id: string;
  tenantId?: string | null;
  userId?: string | null;
  level: string;
  message: string;
  stack?: string | null;
  path?: string | null;
  method?: string | null;
  statusCode: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: any;
  createdAt: Date;
}

export interface CreateErrorLogInput {
  id?: string;
  tenantId?: string | null;
  userId?: string | null;
  level?: string;
  message: string;
  stack?: string | null;
  path?: string | null;
  method?: string | null;
  statusCode?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: any;
}

export class ErrorLogModel {
  private static mapRow(row: any): ErrorLog {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      level: row.level,
      message: row.message,
      stack: row.stack,
      path: row.path,
      method: row.method,
      statusCode: row.status_code,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      metadata: row.metadata,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Persist an error record to the database
   */
  static async create(data: CreateErrorLogInput, client?: PoolClient): Promise<ErrorLog> {
    const sql = `
      INSERT INTO error_logs (
        id, tenant_id, user_id, level, message, stack,
        path, method, status_code, ip_address, user_agent, metadata, created_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId || null,
      data.userId || null,
      data.level || 'ERROR',
      data.message,
      data.stack || null,
      data.path || null,
      data.method || null,
      data.statusCode || 500,
      data.ipAddress || null,
      data.userAgent || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ];

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  /**
   * Find recent errors with optional tenant filter and pagination
   */
  static async findRecent(options: {
    tenantId?: string;
    level?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<ErrorLog[]> {
    const { tenantId, level, limit = 50, offset = 0 } = options;
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (tenantId) {
      conditions.push(`tenant_id = $${paramIdx++}`);
      values.push(tenantId);
    }

    if (level) {
      conditions.push(`level = $${paramIdx++}`);
      values.push(level);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT * FROM error_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    values.push(limit, offset);

    const res = await query(sql, values);
    return res.rows.map(this.mapRow);
  }

  /**
   * Count error records
   */
  static async count(options: { tenantId?: string; level?: string } = {}): Promise<number> {
    const { tenantId, level } = options;
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (tenantId) {
      conditions.push(`tenant_id = $${paramIdx++}`);
      values.push(tenantId);
    }

    if (level) {
      conditions.push(`level = $${paramIdx++}`);
      values.push(level);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) FROM error_logs ${whereClause}`;
    const res = await query(sql, values);
    return parseInt(res.rows[0].count, 10);
  }
}

export default ErrorLogModel;
