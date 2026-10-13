// ══════════════════════════════════════════════════════════════════════
// User Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { User, UserWithTenant, UserRole, ProjectScope, UserModulePermissions } from './types';

export interface CreateUserInput {
  id?: string;
  tenantId?: string | null;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  nationalId?: string | null;
  role?: UserRole;
  projectScope?: ProjectScope;
  permissions?: UserModulePermissions | null;
  mpesaNumber?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  hourlyRate?: number | null;
  fixedRate?: number | null;
  avatarUrl?: string | null;
}

export interface UpdateTeamMemberInput {
  firstName: string;
  lastName: string;
  phone?: string | null;
  role?: UserRole;
  projectScope?: ProjectScope;
  permissions?: UserModulePermissions | null;
  hourlyRate?: number | null;
  mpesaNumber?: string | null;
  isActive?: boolean;
}

export class UserModel {
  private static mapRow(row: any): User {
    let parsedPermissions: UserModulePermissions | null = null;
    if (row.permissions) {
      if (typeof row.permissions === 'string') {
        try {
          parsedPermissions = JSON.parse(row.permissions);
        } catch {
          parsedPermissions = null;
        }
      } else if (typeof row.permissions === 'object') {
        parsedPermissions = row.permissions;
      }
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      passwordHash: row.password_hash,
      firstName: row.first_name,
      lastName: row.last_name,
      phone: row.phone,
      nationalId: row.national_id,
      role: row.role,
      projectScope: (row.project_scope as ProjectScope) || (row.role === UserRole.TEAM_MEMBER || row.role === UserRole.CLIENT_PORTAL ? 'ASSIGNED' : 'ALL'),
      permissions: parsedPermissions,
      mpesaNumber: row.mpesa_number,
      bankName: row.bank_name,
      bankAccount: row.bank_account,
      hourlyRate: row.hourly_rate != null ? parseFloat(row.hourly_rate) : null,
      fixedRate: row.fixed_rate != null ? parseFloat(row.fixed_rate) : null,
      avatarUrl: row.avatar_url,
      isActive: row.is_active,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Find user by unique ID
   */
  static async findById(id: string, client?: PoolClient): Promise<User | null> {
    const sql = `
      SELECT * FROM users
      WHERE id = $1
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  /**
   * Find user by email (case-insensitive) with attached tenant metadata
   */
  static async findByEmail(email: string, client?: PoolClient): Promise<UserWithTenant | null> {
    const sql = `
      SELECT 
        u.*,
        t.id AS tenant_id_val,
        t.name AS tenant_name,
        t.is_active AS tenant_is_active
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE LOWER(u.email) = LOWER($1)
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [email.trim()]);
    if (!res.rows[0]) return null;

    const row = res.rows[0];
    const user = this.mapRow(row) as UserWithTenant;

    if (row.tenant_id_val) {
      user.tenant = {
        id: row.tenant_id_val,
        name: row.tenant_name,
        isActive: row.tenant_is_active,
      };
    } else {
      user.tenant = null;
    }

    return user;
  }

  /**
   * Create a new user record
   */
  static async create(data: CreateUserInput, client?: PoolClient): Promise<User> {
    const sql = `
      INSERT INTO users (
        id, tenant_id, email, password_hash, first_name, last_name,
        phone, national_id, role, mpesa_number, bank_name,
        bank_account, hourly_rate, fixed_rate, avatar_url,
        project_scope, permissions, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId || null,
      data.email.toLowerCase().trim(),
      data.passwordHash,
      data.firstName.trim(),
      data.lastName.trim(),
      data.phone || null,
      data.nationalId || null,
      data.role || UserRole.TEAM_MEMBER,
      data.mpesaNumber || null,
      data.bankName || null,
      data.bankAccount || null,
      data.hourlyRate || null,
      data.fixedRate || null,
      data.avatarUrl || null,
      data.projectScope || (data.role === UserRole.TEAM_MEMBER || data.role === UserRole.CLIENT_PORTAL ? 'ASSIGNED' : 'ALL'),
      data.permissions ? JSON.stringify(data.permissions) : null,
    ];

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  /**
   * Update full team member details & permissions
   */
  static async updateTeamMember(
    id: string,
    data: UpdateTeamMemberInput,
    client?: PoolClient
  ): Promise<User> {
    const sql = `
      UPDATE users
      SET 
        first_name = $1,
        last_name = $2,
        phone = $3,
        role = COALESCE($4, role),
        project_scope = COALESCE($5, project_scope),
        permissions = $6,
        hourly_rate = $7,
        mpesa_number = $8,
        is_active = COALESCE($9, is_active),
        updated_at = NOW()
      WHERE id = $10
      RETURNING *
    `;
    const values = [
      data.firstName.trim(),
      data.lastName.trim(),
      data.phone ? data.phone.trim() : null,
      data.role || null,
      data.projectScope || null,
      data.permissions ? JSON.stringify(data.permissions) : null,
      data.hourlyRate != null ? data.hourlyRate : null,
      data.mpesaNumber ? data.mpesaNumber.trim() : null,
      data.isActive !== undefined ? data.isActive : null,
      id,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  /**
   * Toggle user active status
   */
  static async toggleActive(id: string, client?: PoolClient): Promise<boolean> {
    const sql = `
      UPDATE users
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = $1
      RETURNING is_active
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0]?.is_active ?? false;
  }

  /**
   * Update last login timestamp
   */
  static async updateLastLogin(id: string, client?: PoolClient): Promise<void> {
    const sql = `
      UPDATE users
      SET last_login_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `;
    const runner = client ? client.query.bind(client) : query;
    await runner(sql, [id]);
  }

  /**
   * Upsert user (used primarily in seeding or sync)
   */
  static async upsert(data: CreateUserInput, client?: PoolClient): Promise<User> {
    const existing = await this.findByEmail(data.email, client);
    if (existing) {
      return existing;
    }
    return await this.create(data, client);
  }

  /**
   * Find users by tenant ID
   */
  static async findByTenant(tenantId: string, client?: PoolClient): Promise<User[]> {
    const sql = `
      SELECT * FROM users
      WHERE tenant_id = $1
      ORDER BY first_name ASC, last_name ASC
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId]);
    return res.rows.map(this.mapRow);
  }

  /**
   * Find user by unique ID with attached tenant metadata
   */
  static async findByIdWithTenant(id: string, client?: PoolClient): Promise<UserWithTenant | null> {
    const sql = `
      SELECT 
        u.*,
        t.id AS tenant_id_val,
        t.name AS tenant_name,
        t.is_active AS tenant_is_active
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE u.id = $1
      LIMIT 1
    `;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    if (!res.rows[0]) return null;

    const row = res.rows[0];
    const user = this.mapRow(row) as UserWithTenant;

    if (row.tenant_id_val) {
      user.tenant = {
        id: row.tenant_id_val,
        name: row.tenant_name,
        isActive: row.tenant_is_active,
      };
    } else {
      user.tenant = null;
    }

    return user;
  }

  /**
   * Update user profile contact information
   */
  static async updateProfile(
    id: string,
    data: { firstName: string; lastName: string; phone?: string | null; mpesaNumber?: string | null },
    client?: PoolClient
  ): Promise<User> {
    const sql = `
      UPDATE users
      SET 
        first_name = $1,
        last_name = $2,
        phone = $3,
        mpesa_number = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `;
    const values = [
      data.firstName.trim(),
      data.lastName.trim(),
      data.phone ? data.phone.trim() : null,
      data.mpesaNumber ? data.mpesaNumber.trim() : null,
      id,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  /**
   * Update user password hash
   */
  static async updatePassword(
    id: string,
    passwordHash: string,
    client?: PoolClient
  ): Promise<void> {
    const sql = `
      UPDATE users
      SET password_hash = $1, updated_at = NOW()
      WHERE id = $2
    `;
    const runner = client ? client.query.bind(client) : query;
    await runner(sql, [passwordHash, id]);
  }
}
