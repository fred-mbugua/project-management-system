// ══════════════════════════════════════════════════════════════════════
// User Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { User, UserWithTenant, UserRole } from './types';

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
  mpesaNumber?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  hourlyRate?: number | null;
  fixedRate?: number | null;
  avatarUrl?: string | null;
}

export class UserModel {
  private static mapRow(row: any): User {
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
        bank_account, hourly_rate, fixed_rate, avatar_url, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
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
    ];

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
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
}
