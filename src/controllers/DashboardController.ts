// ══════════════════════════════════════════════════════════════════════
// Dashboard Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const dashboardLogger = logger.child('DashboardController');

export class DashboardController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.redirect('/auth/login');
        return;
      }

      const isSuperAdmin = user.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;

      if (isSuperAdmin) {
        // Platform-level stats for Super Admin
        const [tenantsRes, usersRes, subscriptionsRes, paymentsRes, recentTenantsRes] =
          await Promise.all([
            query(`SELECT COUNT(*)::int as count FROM tenants WHERE is_active = TRUE`),
            query(`SELECT COUNT(*)::int as count FROM users WHERE is_active = TRUE`),
            query(
              `SELECT COUNT(*)::int as count FROM tenant_subscriptions WHERE status = 'ACTIVE'`
            ),
            query(
              `SELECT COALESCE(SUM(amount), 0)::numeric as total FROM payments WHERE status = 'COMPLETED'`
            ),
            query(`
              SELECT t.*, ts.status as sub_status, sp.name as plan_name 
              FROM tenants t 
              LEFT JOIN tenant_subscriptions ts ON t.id = ts.tenant_id 
              LEFT JOIN subscription_plans sp ON ts.plan_id = sp.id 
              ORDER BY t.created_at DESC 
              LIMIT 5
            `),
          ]);

        const stats = {
          totalTenants: tenantsRes.rows[0]?.count || 0,
          totalUsers: usersRes.rows[0]?.count || 0,
          activeSubscriptions: subscriptionsRes.rows[0]?.count || 0,
          totalRevenue: parseFloat(paymentsRes.rows[0]?.total || 0),
          formattedRevenue: formatKES(parseFloat(paymentsRes.rows[0]?.total || 0)),
        };

        res.render('pages/dashboard/super-admin', {
          title: 'Platform Overview',
          stats,
          recentTenants: recentTenantsRes.rows,
        });
        return;
      }

      // Tenant-level dashboard stats
      if (!tenantId) {
        req.flash('error', 'No organization associated with this user.');
        res.redirect('/auth/login');
        return;
      }

      const [
        projectCountsRes,
        taskCountsRes,
        financialsRes,
        recentProjectsRes,
        recentInvoicesRes,
        recentTasksRes,
      ] = await Promise.all([
        query(
          `SELECT 
            COUNT(*)::int as total,
            COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END)::int as active,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int as completed
           FROM projects WHERE tenant_id = $1`,
          [tenantId]
        ),
        query(
          `SELECT 
            COUNT(*)::int as total,
            COUNT(CASE WHEN status != 'COMPLETED' THEN 1 END)::int as pending,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int as completed
           FROM tasks WHERE tenant_id = $1`,
          [tenantId]
        ),
        query(
          `SELECT 
            COALESCE(SUM(total_amount), 0)::numeric as total_invoiced,
            COALESCE(SUM(amount_paid), 0)::numeric as total_received,
            COALESCE(SUM(balance_due), 0)::numeric as total_due
           FROM invoices WHERE tenant_id = $1`,
          [tenantId]
        ),
        query(
          `SELECT p.*, c.name as client_name,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) as task_count,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'COMPLETED') as completed_task_count
           FROM projects p
           LEFT JOIN clients c ON p.client_id = c.id
           WHERE p.tenant_id = $1
           ORDER BY p.created_at DESC
           LIMIT 5`,
          [tenantId]
        ),
        query(
          `SELECT i.*, c.name as client_name
           FROM invoices i
           LEFT JOIN clients c ON i.client_id = c.id
           WHERE i.tenant_id = $1
           ORDER BY i.created_at DESC
           LIMIT 5`,
          [tenantId]
        ),
        query(
          `SELECT t.*, p.name as project_name, u.first_name, u.last_name
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users u ON t.assigned_to_id = u.id
           WHERE t.tenant_id = $1
           ORDER BY t.created_at DESC
           LIMIT 5`,
          [tenantId]
        ),
      ]);

      const projectCounts = projectCountsRes.rows[0] || { total: 0, active: 0, completed: 0 };
      const taskCounts = taskCountsRes.rows[0] || { total: 0, pending: 0, completed: 0 };
      const financials = financialsRes.rows[0] || {
        total_invoiced: 0,
        total_received: 0,
        total_due: 0,
      };

      const stats = {
        totalProjects: projectCounts.total,
        activeProjects: projectCounts.active,
        completedProjects: projectCounts.completed,
        totalTasks: taskCounts.total,
        pendingTasks: taskCounts.pending,
        completedTasks: taskCounts.completed,
        totalInvoiced: parseFloat(financials.total_invoiced),
        totalReceived: parseFloat(financials.total_received),
        totalDue: parseFloat(financials.total_due),
        formattedReceived: formatKES(parseFloat(financials.total_received)),
        formattedDue: formatKES(parseFloat(financials.total_due)),
      };

      res.render('pages/dashboard/index', {
        title: 'Dashboard',
        stats,
        recentProjects: recentProjectsRes.rows,
        recentInvoices: recentInvoicesRes.rows,
        recentTasks: recentTasksRes.rows,
        formatKES,
      });
    } catch (error) {
      dashboardLogger.error('Dashboard rendering error', { error: String(error) });
      next(error);
    }
  };
}

export default new DashboardController();
