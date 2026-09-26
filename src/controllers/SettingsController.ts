// ══════════════════════════════════════════════════════════════════════
// Settings Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { TenantModel } from '../models/tenant.model';
import { DarajaShortcodeType } from '../models/types';
import logger from '../utils/logger';

const setLogger = logger.child('SettingsController');

export class SettingsController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let tenantId = req.tenantId;
      if (!tenantId && req.user?.role === 'SUPER_ADMIN') {
        const first = await query('SELECT * FROM tenants WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
        if (first.rows.length > 0) {
          tenantId = first.rows[0].id;
        }
      }
      if (!tenantId) {
        req.flash('error', 'Tenant organization not found.');
        res.redirect('/dashboard');
        return;
      }

      const tenant = await TenantModel.findById(tenantId);
      if (!tenant) {
        req.flash('error', 'Tenant organization not found.');
        res.redirect('/dashboard');
        return;
      }

      res.render('pages/settings/index', {
        title: 'Organization Settings',
        tenant,
      });
    } catch (error) {
      setLogger.error('Failed to load tenant settings', { error: String(error) });
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let tenantId = req.tenantId;
      if (!tenantId && req.user?.role === 'SUPER_ADMIN') {
        const first = await query('SELECT * FROM tenants WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
        if (first.rows.length > 0) {
          tenantId = first.rows[0].id;
        }
      }
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const {
        name,
        phone,
        address,
        city,
        kraPin,
        vatRegistered,
        invoicePrefix,
        quotePrefix,
        invoiceNotes,
        paymentTerms,
        bankDetails,
        darajaShortcode,
        darajaShortcodeType,
        darajaEnvironment,
        primaryColor,
        invoiceTemplate,
      } = req.body;

      await TenantModel.update(tenantId, {
        name,
        phone,
        address,
        city,
        kraPin,
        vatRegistered: vatRegistered === 'on' || vatRegistered === 'true',
        invoicePrefix,
        quotePrefix,
        invoiceNotes,
        paymentTerms,
        bankDetails,
        darajaShortcode,
        darajaShortcodeType: darajaShortcodeType as DarajaShortcodeType,
        darajaEnvironment,
        primaryColor,
        invoiceTemplate,
      });

      req.flash('success', 'Organization settings updated successfully.');
      res.redirect('/settings');
    } catch (error) {
      setLogger.error('Failed to update tenant settings', { error: String(error) });
      next(error);
    }
  };
}

export default new SettingsController();
