// ══════════════════════════════════════════════════════════════════════
// Calendar Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { isAssignedProjectsOnly, hasModulePermission } from '../middleware/rbac';
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

      const isScoped = req.user ? isAssignedProjectsOnly(req.user) : false;
      const canSeeInvoices = hasModulePermission(req.user, 'invoices', 'view');
      const canSeeMaintenance = hasModulePermission(req.user, 'maintenance', 'view');

      // 1. Projects query
      let projSql = `
        SELECT id, name as title, end_date as event_date, status, 'PROJECT' as event_type
        FROM projects
        WHERE end_date IS NOT NULL AND status != 'COMPLETED'
      `;
      const projParams: any[] = [];
      if (tenantId && !isSuper) {
        projParams.push(tenantId);
        projSql += ` AND tenant_id = $${projParams.length}`;
      }
      if (isScoped && req.user) {
        projParams.push(req.user.id);
        projSql += ` AND (id IN (SELECT project_id FROM project_members WHERE user_id = $${projParams.length}) OR id IN (SELECT project_id FROM tasks WHERE assigned_to_id = $${projParams.length}))`;
      }
      projSql += ` ORDER BY end_date ASC LIMIT 20`;

      // 2. Tasks query
      let taskSql = `
        SELECT t.id, t.title, t.due_date as event_date, t.priority, t.status, p.code as project_code, 'TASK' as event_type
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        WHERE t.due_date IS NOT NULL AND t.status != 'COMPLETED'
      `;
      const taskParams: any[] = [];
      if (tenantId && !isSuper) {
        taskParams.push(tenantId);
        taskSql += ` AND t.tenant_id = $${taskParams.length}`;
      }
      if (isScoped && req.user) {
        taskParams.push(req.user.id);
        taskSql += ` AND (t.project_id IN (SELECT project_id FROM project_members WHERE user_id = $${taskParams.length}) OR t.assigned_to_id = $${taskParams.length})`;
      }
      taskSql += ` ORDER BY t.due_date ASC LIMIT 20`;

      // 3. Invoices query (if permitted)
      let invSql = `
        SELECT i.id, i.invoice_number as title, i.due_date as event_date, i.balance_due, c.name as client_name, 'INVOICE' as event_type
        FROM invoices i
        JOIN clients c ON i.client_id = c.id
        WHERE i.due_date IS NOT NULL AND i.status NOT IN ('PAID', 'CANCELLED', 'VOID')
      `;
      const invParams: any[] = [];
      if (tenantId && !isSuper) {
        invParams.push(tenantId);
        invSql += ` AND i.tenant_id = $${invParams.length}`;
      }
      if (isScoped && req.user) {
        invParams.push(req.user.id);
        invSql += ` AND i.project_id IS NOT NULL AND (i.project_id IN (SELECT project_id FROM project_members WHERE user_id = $${invParams.length}) OR i.project_id IN (SELECT project_id FROM tasks WHERE assigned_to_id = $${invParams.length}))`;
      }
      invSql += ` ORDER BY i.due_date ASC LIMIT 20`;

      // 4. Maintenance query (if permitted)
      let maintSql = `
        SELECT m.id, m.title, m.next_due_date as event_date, m.frequency, c.name as client_name, 'MAINTENANCE' as event_type
        FROM maintenance_schedules m
        JOIN clients c ON m.client_id = c.id
        WHERE m.next_due_date IS NOT NULL AND m.status = 'ACTIVE'
      `;
      const maintParams: any[] = [];
      if (tenantId && !isSuper) {
        maintParams.push(tenantId);
        maintSql += ` AND m.tenant_id = $${maintParams.length}`;
      }
      if (isScoped && req.user) {
        maintParams.push(req.user.id);
        maintSql += ` AND m.project_id IS NOT NULL AND (m.project_id IN (SELECT project_id FROM project_members WHERE user_id = $${maintParams.length}) OR m.project_id IN (SELECT project_id FROM tasks WHERE assigned_to_id = $${maintParams.length}))`;
      }
      maintSql += ` ORDER BY m.next_due_date ASC LIMIT 20`;

      // Fetch timeline events from projects, tasks, invoices, and maintenance
      const [projectsRes, tasksRes, invoicesRes, maintRes] = await Promise.all([
        query(projSql, projParams),
        query(taskSql, taskParams),
        canSeeInvoices ? query(invSql, invParams) : Promise.resolve({ rows: [] }),
        canSeeMaintenance ? query(maintSql, maintParams) : Promise.resolve({ rows: [] }),
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
