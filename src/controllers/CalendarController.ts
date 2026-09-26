// ══════════════════════════════════════════════════════════════════════
// Calendar Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import logger from '../utils/logger';

const calLogger = logger.child('CalendarController');

export class CalendarController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;
      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      // Fetch timeline events from projects, tasks, invoices, and maintenance
      const [projectsRes, tasksRes, invoicesRes, maintRes] = await Promise.all([
        tenantId
          ? query(`
              SELECT id, name as title, end_date as event_date, status, 'PROJECT' as event_type
              FROM projects
              WHERE tenant_id = $1 AND end_date IS NOT NULL AND status != 'COMPLETED'
              ORDER BY end_date ASC
              LIMIT 20
            `, [tenantId])
          : query(`
              SELECT id, name as title, end_date as event_date, status, 'PROJECT' as event_type
              FROM projects
              WHERE end_date IS NOT NULL AND status != 'COMPLETED'
              ORDER BY end_date ASC
              LIMIT 20
            `),
        tenantId
          ? query(`
              SELECT t.id, t.title, t.due_date as event_date, t.priority, t.status, p.code as project_code, 'TASK' as event_type
              FROM tasks t
              JOIN projects p ON t.project_id = p.id
              WHERE t.tenant_id = $1 AND t.due_date IS NOT NULL AND t.status != 'COMPLETED'
              ORDER BY t.due_date ASC
              LIMIT 20
            `, [tenantId])
          : query(`
              SELECT t.id, t.title, t.due_date as event_date, t.priority, t.status, p.code as project_code, 'TASK' as event_type
              FROM tasks t
              JOIN projects p ON t.project_id = p.id
              WHERE t.due_date IS NOT NULL AND t.status != 'COMPLETED'
              ORDER BY t.due_date ASC
              LIMIT 20
            `),
        tenantId
          ? query(`
              SELECT i.id, i.invoice_number as title, i.due_date as event_date, i.balance_due, c.name as client_name, 'INVOICE' as event_type
              FROM invoices i
              JOIN clients c ON i.client_id = c.id
              WHERE i.tenant_id = $1 AND i.due_date IS NOT NULL AND i.status NOT IN ('PAID', 'CANCELLED', 'VOID')
              ORDER BY i.due_date ASC
              LIMIT 20
            `, [tenantId])
          : query(`
              SELECT i.id, i.invoice_number as title, i.due_date as event_date, i.balance_due, c.name as client_name, 'INVOICE' as event_type
              FROM invoices i
              JOIN clients c ON i.client_id = c.id
              WHERE i.due_date IS NOT NULL AND i.status NOT IN ('PAID', 'CANCELLED', 'VOID')
              ORDER BY i.due_date ASC
              LIMIT 20
            `),
        tenantId
          ? query(`
              SELECT m.id, m.title, m.next_due_date as event_date, m.frequency, c.name as client_name, 'MAINTENANCE' as event_type
              FROM maintenance_schedules m
              JOIN clients c ON m.client_id = c.id
              WHERE m.tenant_id = $1 AND m.next_due_date IS NOT NULL AND m.status = 'ACTIVE'
              ORDER BY m.next_due_date ASC
              LIMIT 20
            `, [tenantId])
          : query(`
              SELECT m.id, m.title, m.next_due_date as event_date, m.frequency, c.name as client_name, 'MAINTENANCE' as event_type
              FROM maintenance_schedules m
              JOIN clients c ON m.client_id = c.id
              WHERE m.next_due_date IS NOT NULL AND m.status = 'ACTIVE'
              ORDER BY m.next_due_date ASC
              LIMIT 20
            `),
      ]);

      // Normalize into a single events timeline
      const allEvents = [
        ...projectsRes.rows.map(r => ({
          id: r.id,
          title: `Project Milestone: ${r.title}`,
          date: new Date(r.event_date),
          type: 'PROJECT',
          badgeClass: 'badge-primary',
          detail: `Status: ${r.status}`,
          link: `/projects/${r.id}`,
        })),
        ...tasksRes.rows.map(r => ({
          id: r.id,
          title: `Task Deadline: ${r.title}`,
          date: new Date(r.event_date),
          type: 'TASK',
          badgeClass: 'badge-warning',
          detail: `[${r.project_code}] Priority: ${r.priority}`,
          link: '/projects',
        })),
        ...invoicesRes.rows.map(r => ({
          id: r.id,
          title: `Invoice Due: ${r.title}`,
          date: new Date(r.event_date),
          type: 'INVOICE',
          badgeClass: 'badge-danger',
          detail: `Client: ${r.client_name}`,
          link: `/invoices/${r.id}`,
        })),
        ...maintRes.rows.map(r => ({
          id: r.id,
          title: `Inspection: ${r.title}`,
          date: new Date(r.event_date),
          type: 'MAINTENANCE',
          badgeClass: 'badge-info',
          detail: `Client: ${r.client_name} (${r.frequency})`,
          link: '/maintenance',
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      res.render('pages/calendar/index', {
        title: 'Project & Operations Calendar',
        events: allEvents,
      });
    } catch (error) {
      calLogger.error('Failed to load calendar events', { error: String(error) });
      next(error);
    }
  };
}

export default new CalendarController();
