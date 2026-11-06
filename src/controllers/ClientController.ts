// ══════════════════════════════════════════════════════════════════════
// Client Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ClientModel, AuditAction } from '../models';
import ActionLogService from '../services/actionLog.service';
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

      const { name, contactPerson, email, phone, address, city, country, kraPin, notes } = req.body;

      if (!name || !name.trim()) {
        req.flash('error', 'Client/Company name is required.');
        res.redirect('/clients/new');
        return;
      }

      const newClient = await ClientModel.create({
        tenantId,
        name: name.trim(),
        contactPerson: contactPerson?.trim() || null,
        email: email?.toLowerCase().trim() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        country: country?.trim() || 'Kenya',
        kraPin: kraPin?.toUpperCase().trim() || null,
        notes: notes?.trim() || null,
      });

      await ActionLogService.record(req, {
        action: AuditAction.CREATE,
        entityType: 'client',
        entityId: newClient.id,
        description: `Created new client profile "${newClient.name}"`,
      });

      req.flash('success', `Client "${name.trim()}" added successfully.`);
      res.redirect('/clients');
    } catch (error) {
      clientLogger.error('Failed to create client', { error: String(error) });
      next(error);
    }
  };

  showEdit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const client = await ClientModel.findById(id, isSuper ? null : (tenantId || null));
      if (!client) {
        req.flash('error', 'Client not found.');
        res.redirect('/clients');
        return;
      }

      res.render('pages/clients/edit', {
        title: `Edit ${client.name}`,
        client,
      });
    } catch (error) {
      clientLogger.error('Failed to load edit client page', { error: String(error) });
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const existingClient = await ClientModel.findById(id, isSuper ? null : (tenantId || null));
      if (!existingClient) {
        req.flash('error', 'Client not found.');
        res.redirect('/clients');
        return;
      }

      const { name, contactPerson, email, phone, address, city, country, kraPin, notes, isActive } = req.body;

      if (!name || !name.trim()) {
        req.flash('error', 'Client/Company name is required.');
        res.redirect(`/clients/${id}/edit`);
        return;
      }

      // Optional email validation
      if (email && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        req.flash('error', 'Please provide a valid email address.');
        res.redirect(`/clients/${id}/edit`);
        return;
      }

      const updated = await ClientModel.update(id, isSuper ? null : (tenantId || null), {
        name: name.trim(),
        contactPerson: contactPerson ? contactPerson.trim() : null,
        email: email ? email.toLowerCase().trim() : null,
        phone: phone ? phone.trim() : null,
        address: address ? address.trim() : null,
        city: city ? city.trim() : null,
        country: country ? country.trim() : 'Kenya',
        kraPin: kraPin ? kraPin.toUpperCase().trim() : null,
        notes: notes ? notes.trim() : null,
        isActive: isActive !== undefined ? (isActive === 'true' || isActive === true || isActive === '1') : existingClient.isActive,
      });

      if (!updated) {
        req.flash('error', 'Failed to update client.');
        res.redirect('/clients');
        return;
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'client',
        entityId: id,
        description: `Updated client details for "${name.trim()}"`,
      });

      req.flash('success', `Client "${name.trim()}" updated successfully.`);
      res.redirect('/clients');
    } catch (error) {
      clientLogger.error('Failed to update client', { error: String(error) });
      next(error);
    }
  };

  toggleStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';

      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const existingClient = await ClientModel.findById(id, isSuper ? null : (tenantId || null));
      if (!existingClient) {
        req.flash('error', 'Client not found.');
        res.redirect('/clients');
        return;
      }

      const newStatus = await ClientModel.toggleActive(id, isSuper ? null : (tenantId || null));

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'client',
        entityId: id,
        description: `Toggled status of client "${existingClient.name}" to ${newStatus ? 'Active' : 'Inactive'}`,
      });

      req.flash('success', `Client "${existingClient.name}" is now ${newStatus ? 'active' : 'inactive'}.`);
      res.redirect('/clients');
    } catch (error) {
      clientLogger.error('Failed to toggle client status', { error: String(error) });
      next(error);
    }
  };
}

export default new ClientController();
