// ══════════════════════════════════════════════════════════════════════
// Client Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ClientModel } from '../models';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import logger from '../utils/logger';

const clientLogger = logger.child('ClientController');

export class ClientController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const params = extractPaginationParams(req, 10);
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (tenantId && !isSuper) {
        conditions.push(`c.tenant_id = $${paramIdx++}`);
        values.push(tenantId);
      }

      if (params.search) {
        conditions.push(`(
          c.name ILIKE $${paramIdx} OR
          c.contact_person ILIKE $${paramIdx} OR
          c.email ILIKE $${paramIdx} OR
          c.phone ILIKE $${paramIdx} OR
          c.kra_pin ILIKE $${paramIdx} OR
          c.city ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`c.created_at >= $${paramIdx++}::timestamptz`);
        values.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        conditions.push(`c.created_at <= $${paramIdx++}::timestamptz`);
        values.push(`${params.endDate}T23:59:59Z`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countSql = `SELECT COUNT(*)::int as total FROM clients c ${whereClause}`;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

      const dataSql = `
        SELECT 
          c.*,
          (SELECT COUNT(*)::int FROM projects p WHERE p.client_id = c.id) as project_count,
          (SELECT COUNT(*)::int FROM invoices i WHERE i.client_id = c.id) as invoice_count
        FROM clients c
        ${whereClause}
        ORDER BY c.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];
      const result = await query(dataSql, dataValues);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/clients/index', {
        title: 'Clients',
        clients: result.rows,
        pagination,
        filters: params,
      });
    } catch (error) {
      clientLogger.error('Failed to list clients', { error: String(error) });
      next(error);
    }
  };

  showNew = async (_req: Request, res: Response): Promise<void> => {
    res.render('pages/clients/new', {
      title: 'New Client',
    });
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const { name, contactPerson, email, phone, address, city, kraPin, notes } = req.body;

      if (!name) {
        req.flash('error', 'Client/Company name is required.');
        res.redirect('/clients/new');
        return;
      }

      await ClientModel.create({
        tenantId,
        name,
        contactPerson: contactPerson || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        kraPin: kraPin || null,
        notes: notes || null,
      });

      req.flash('success', `Client "${name}" added successfully.`);
      res.redirect('/clients');
    } catch (error) {
      clientLogger.error('Failed to create client', { error: String(error) });
      next(error);
    }
  };
}

export default new ClientController();
