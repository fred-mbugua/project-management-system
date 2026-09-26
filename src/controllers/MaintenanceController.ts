// ══════════════════════════════════════════════════════════════════════
// Maintenance Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { MaintenanceFrequency, MaintenanceStatus } from '../models/types';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const maintLogger = logger.child('MaintenanceController');

export class MaintenanceController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const [schedulesRes, clientsRes, projectsRes] = await Promise.all([
        tenantId
          ? query(`
              SELECT 
                m.*,
                c.name as client_name,
                c.phone as client_phone,
                p.name as project_name,
                p.code as project_code
              FROM maintenance_schedules m
              JOIN clients c ON m.client_id = c.id
              LEFT JOIN projects p ON m.project_id = p.id
              WHERE m.tenant_id = $1
              ORDER BY m.next_due_date ASC
            `, [tenantId])
          : query(`
              SELECT 
                m.*,
                c.name as client_name,
                c.phone as client_phone,
                p.name as project_name,
                p.code as project_code
              FROM maintenance_schedules m
              JOIN clients c ON m.client_id = c.id
              LEFT JOIN projects p ON m.project_id = p.id
              ORDER BY m.next_due_date ASC
            `),
        tenantId
          ? query(`SELECT id, name FROM clients WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name ASC`, [tenantId])
          : query(`SELECT id, name FROM clients WHERE is_active = TRUE ORDER BY name ASC`),
        tenantId
          ? query(`SELECT id, name, code FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED' ORDER BY name ASC`, [tenantId])
          : query(`SELECT id, name, code FROM projects WHERE status != 'CANCELLED' ORDER BY name ASC`),
      ]);

      const schedules = schedulesRes.rows;
      const activeCount = schedules.filter(s => s.status === 'ACTIVE').length;
      const totalMRR = schedules
        .filter(s => s.status === 'ACTIVE')
        .reduce((sum, s) => sum + parseFloat(s.charge_amount || 0), 0);

      res.render('pages/maintenance/index', {
        title: 'Maintenance Contracts',
        schedules,
        clients: clientsRes.rows,
        projects: projectsRes.rows,
        frequencies: Object.values(MaintenanceFrequency),
        stats: {
          activeCount,
          totalMRR,
          totalSchedules: schedules.length,
        },
        formatKES,
      });
    } catch (error) {
      maintLogger.error('Failed to list maintenance schedules', { error: String(error) });
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      let tenantId = req.tenantId;
      if (!tenantId && isSuper) {
        const first = await query('SELECT id FROM tenants WHERE is_active = TRUE LIMIT 1');
        tenantId = first.rows[0]?.id;
      }
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const { title, clientId, projectId, frequency, chargeAmount, nextDueDate, notes } = req.body;

      if (!title || !clientId || !chargeAmount || !nextDueDate) {
        req.flash('error', 'Title, Client, Charge Amount, and Next Due Date are required.');
        res.redirect('/maintenance');
        return;
      }

      const sql = `
        INSERT INTO maintenance_schedules (
          id, tenant_id, client_id, project_id, title, frequency, status,
          charge_amount, startDate, next_due_date, notes, updated_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, 'ACTIVE',
          $6, NOW(), $7, $8, NOW()
        )
      `;

      await query(sql, [
        tenantId,
        clientId,
        projectId || null,
        title,
        frequency || MaintenanceFrequency.MONTHLY,
        parseFloat(chargeAmount) || 0,
        new Date(nextDueDate),
        notes || null,
      ]);

      req.flash('success', 'Maintenance contract scheduled successfully.');
      res.redirect('/maintenance');
    } catch (error) {
      maintLogger.error('Failed to create maintenance schedule', { error: String(error) });
      next(error);
    }
  };
}

export default new MaintenanceController();
