// ══════════════════════════════════════════════════════════════════════
// Client Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ClientModel } from '../models';
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

      const sql = (isSuper && !tenantId)
        ? `
          SELECT 
            c.*,
            (SELECT COUNT(*)::int FROM projects p WHERE p.client_id = c.id) as project_count,
            (SELECT COUNT(*)::int FROM invoices i WHERE i.client_id = c.id) as invoice_count
          FROM clients c
          ORDER BY c.created_at DESC
        `
        : `
          SELECT 
            c.*,
            (SELECT COUNT(*)::int FROM projects p WHERE p.client_id = c.id) as project_count,
            (SELECT COUNT(*)::int FROM invoices i WHERE i.client_id = c.id) as invoice_count
          FROM clients c
          WHERE c.tenant_id = $1
          ORDER BY c.created_at DESC
        `;
      const result = (isSuper && !tenantId) ? await query(sql) : await query(sql, [tenantId]);

      res.render('pages/clients/index', {
        title: 'Clients',
        clients: result.rows,
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
