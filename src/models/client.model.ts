// ══════════════════════════════════════════════════════════════════════
// Client Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Client } from './types';

export interface CreateClientInput {
  id?: string;
  tenantId: string;
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  kraPin?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface UpdateClientInput {
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  kraPin?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export class ClientModel {
  private static mapRow(row: any): Client {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      contactPerson: row.contact_person,
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      country: row.country,
      kraPin: row.kra_pin,
      notes: row.notes,
      isActive: row.is_active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  static async findById(id: string, tenantId?: string | null, client?: PoolClient): Promise<Client | null> {
    let sql = `SELECT * FROM clients WHERE id = $1`;
    const params: any[] = [id];
    if (tenantId) {
      sql += ` AND tenant_id = $2`;
      params.push(tenantId);
    }
    sql += ` LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, params);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByTenant(tenantId: string, client?: PoolClient): Promise<Client[]> {
    const sql = `SELECT * FROM clients WHERE tenant_id = $1 ORDER BY name ASC`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [tenantId]);
    return res.rows.map(this.mapRow);
  }

  static async create(data: CreateClientInput, client?: PoolClient): Promise<Client> {
    const sql = `
      INSERT INTO clients (
        id, tenant_id, name, contact_person, email, phone,
        address, city, country, kra_pin, notes, is_active, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.name.trim(),
      data.contactPerson || null,
      data.email?.toLowerCase().trim() || null,
      data.phone || null,
      data.address || null,
      data.city || null,
      data.country || 'Kenya',
      data.kraPin || null,
      data.notes || null,
      data.isActive ?? true,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  static async update(
    id: string,
    tenantId: string | null,
    data: UpdateClientInput,
    client?: PoolClient
  ): Promise<Client | null> {
    const isSuper = tenantId === null;
    let sql: string;
    let values: any[];

    if (isSuper) {
      sql = `
        UPDATE clients SET
          name = $1,
          contact_person = $2,
          email = $3,
          phone = $4,
          address = $5,
          city = $6,
          country = COALESCE($7, 'Kenya'),
          kra_pin = $8,
          notes = $9,
          is_active = COALESCE($10, is_active),
          updated_at = NOW()
        WHERE id = $11
        RETURNING *
      `;
      values = [
        data.name.trim(),
        data.contactPerson?.trim() || null,
        data.email?.toLowerCase().trim() || null,
        data.phone?.trim() || null,
        data.address?.trim() || null,
        data.city?.trim() || null,
        data.country?.trim() || 'Kenya',
        data.kraPin?.toUpperCase().trim() || null,
        data.notes?.trim() || null,
        data.isActive !== undefined ? data.isActive : null,
        id,
      ];
    } else {
      sql = `
        UPDATE clients SET
          name = $1,
          contact_person = $2,
          email = $3,
          phone = $4,
          address = $5,
          city = $6,
          country = COALESCE($7, 'Kenya'),
          kra_pin = $8,
          notes = $9,
          is_active = COALESCE($10, is_active),
          updated_at = NOW()
        WHERE id = $11 AND tenant_id = $12
        RETURNING *
      `;
      values = [
        data.name.trim(),
        data.contactPerson?.trim() || null,
        data.email?.toLowerCase().trim() || null,
        data.phone?.trim() || null,
        data.address?.trim() || null,
        data.city?.trim() || null,
        data.country?.trim() || 'Kenya',
        data.kraPin?.toUpperCase().trim() || null,
        data.notes?.trim() || null,
        data.isActive !== undefined ? data.isActive : null,
        id,
        tenantId,
      ];
    }

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async toggleActive(id: string, tenantId?: string | null, client?: PoolClient): Promise<boolean> {
    const isSuper = !tenantId;
    let sql = `
      UPDATE clients
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id = $1
    `;
    const values: any[] = [id];
    if (!isSuper) {
      sql += ` AND tenant_id = $2`;
      values.push(tenantId);
    }
    sql += ` RETURNING is_active`;

    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return res.rows[0]?.is_active ?? false;
  }

  static async upsert(data: CreateClientInput, client?: PoolClient): Promise<Client> {
    if (data.id) {
      const existing = await this.findById(data.id, data.tenantId, client);
      if (existing) return existing;
    }
    return await this.create(data, client);
  }
}
