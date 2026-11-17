// ══════════════════════════════════════════════════════════════════════
// Project Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Project, ProjectStatus } from './types';

export interface CreateProjectInput {
  id?: string;
  tenantId: string;
  clientId?: string | null;
  name: string;
  code: string;
  description?: string | null;
  status?: ProjectStatus;
  budget?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
}

export interface UpdateProjectInput {
  clientId?: string | null;
  name: string;
  code: string;
  description?: string | null;
  status: ProjectStatus;
  budget?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  completedAt?: Date | null;
}

export class ProjectModel {
  private static mapRow(row: any): Project {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      clientId: row.client_id,
      name: row.name,
      code: row.code,
      description: row.description,
      status: row.status,
      budget: row.budget != null ? parseFloat(row.budget) : null,
      startDate: row.start_date ? new Date(row.start_date) : null,
      endDate: row.end_date ? new Date(row.end_date) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  static async findById(id: string, client?: PoolClient): Promise<Project | null> {
    const sql = `SELECT * FROM projects WHERE id = $1 LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByIdAndTenant(
    id: string,
    tenantId: string | null,
    client?: PoolClient
  ): Promise<Project | null> {
    const params: any[] = [id];
    const tenantFilter = tenantId ? (params.push(tenantId), ` AND tenant_id = $2`) : '';
    const sql = `SELECT * FROM projects WHERE id = $1${tenantFilter} LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, params);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByTenantAndCode(
    tenantId: string,
    code: string,
    client?: PoolClient
  ): Promise<Project | null> {
    const sql = `
      SELECT * FROM projects
      WHERE tenant_id = $1 AND code = $2
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId, code]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByTenantAndCodeExcludingId(
    tenantId: string,
    code: string,
    excludeId: string,
    client?: PoolClient
  ): Promise<Project | null> {
    const sql = `
      SELECT * FROM projects
      WHERE tenant_id = $1 AND code = $2 AND id != $3
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId, code, excludeId]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByTenant(tenantId: string, client?: PoolClient): Promise<Project[]> {
    const sql = `
      SELECT * FROM projects
      WHERE tenant_id = $1
      ORDER BY created_at DESC
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId]);
    return res.rows.map(this.mapRow);
  }

  static async create(data: CreateProjectInput, client?: PoolClient): Promise<Project> {
    const sql = `
      INSERT INTO projects (
        id, tenant_id, client_id, name, code,
        description, status, budget, start_date, end_date, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.clientId || null,
      data.name.trim(),
      data.code.trim(),
      data.description || null,
      data.status || ProjectStatus.PLANNING,
      data.budget ?? null,
      data.startDate || null,
      data.endDate || null,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  static async update(
    id: string,
    tenantId: string | null,
    data: UpdateProjectInput,
    client?: PoolClient
  ): Promise<Project | null> {
    const values: any[] = [
      data.clientId || null,
      data.name.trim(),
      data.code.trim(),
      data.description ?? null,
      data.status,
      data.budget ?? null,
      data.startDate || null,
      data.endDate || null,
      data.completedAt ?? null,
      id,
    ];
    const tenantFilter = tenantId ? (values.push(tenantId), ` AND tenant_id = $11`) : '';
    const sql = `
      UPDATE projects SET
        client_id = $1,
        name = $2,
        code = $3,
        description = $4,
        status = $5,
        budget = $6,
        start_date = $7,
        end_date = $8,
        completed_at = $9,
        updated_at = NOW()
      WHERE id = $10${tenantFilter}
      RETURNING *
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async upsert(data: CreateProjectInput, client?: PoolClient): Promise<Project> {
    const existing = await this.findByTenantAndCode(data.tenantId, data.code, client);
    if (existing) return existing;
    return await this.create(data, client);
  }
}
