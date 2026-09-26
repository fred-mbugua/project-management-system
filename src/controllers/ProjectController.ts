// ══════════════════════════════════════════════════════════════════════
// Project Controller - Raw PostgreSQL Queries
// Project lifecycle, tasks, and team assignments
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ProjectModel, TaskModel, ProjectStatus, TaskPriority, TaskStatus } from '../models';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const projectLogger = logger.child('ProjectController');

export class ProjectController {
  /**
   * List all projects for current tenant
   */
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
            p.*,
            c.name as client_name,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) as task_count,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'COMPLETED') as completed_task_count,
            (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) as member_count
          FROM projects p
          LEFT JOIN clients c ON p.client_id = c.id
          ORDER BY p.created_at DESC
        `
        : `
          SELECT 
            p.*,
            c.name as client_name,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) as task_count,
            (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'COMPLETED') as completed_task_count,
            (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) as member_count
          FROM projects p
          LEFT JOIN clients c ON p.client_id = c.id
          WHERE p.tenant_id = $1
          ORDER BY p.created_at DESC
        `;
      const result = (isSuper && !tenantId) ? await query(sql) : await query(sql, [tenantId]);

      res.render('pages/projects/index', {
        title: 'Projects',
        projects: result.rows,
        formatKES,
      });
    } catch (error) {
      projectLogger.error('Failed to list projects', { error: String(error) });
      next(error);
    }
  };

  /**
   * Render create project form
   */
  showNew = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const clientsRes = await query(`SELECT * FROM clients WHERE tenant_id = $1 AND is_active = TRUE ORDER BY name ASC`, [tenantId]);
      
      res.render('pages/projects/new', {
        title: 'New Project',
        clients: clientsRes.rows,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Create new project
   */
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const { name, code, clientId, description, budget, startDate, endDate, status } = req.body;

      if (!name || !code) {
        req.flash('error', 'Project Name and Project Code are required.');
        res.redirect('/projects/new');
        return;
      }

      // Check code uniqueness
      const existing = await ProjectModel.findByTenantAndCode(tenantId, code);
      if (existing) {
        req.flash('error', `A project with code "${code}" already exists.`);
        res.redirect('/projects/new');
        return;
      }

      const project = await ProjectModel.create({
        tenantId,
        clientId: clientId || null,
        name,
        code,
        description: description || null,
        budget: budget ? parseFloat(budget) : null,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        status: status || ProjectStatus.PLANNING,
      });

      req.flash('success', `Project "${project.name}" (${project.code}) created successfully.`);
      res.redirect(`/projects/${project.id}`);
    } catch (error) {
      projectLogger.error('Failed to create project', { error: String(error) });
      next(error);
    }
  };

  /**
   * Show project detail with tasks and members
   */
  show = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const projectId = req.params.id as string;

      const [projectRes, tasksRes, membersRes, usersRes] = await Promise.all([
        query(`
          SELECT p.*, c.name as client_name, c.email as client_email, c.phone as client_phone
          FROM projects p
          LEFT JOIN clients c ON p.client_id = c.id
          WHERE p.id = $1 AND p.tenant_id = $2
          LIMIT 1
        `, [projectId, tenantId]),
        query(`
          SELECT t.*, u.first_name, u.last_name, u.avatar_url
          FROM tasks t
          LEFT JOIN users u ON t.assigned_to_id = u.id
          WHERE t.project_id = $1 AND t.tenant_id = $2
          ORDER BY t.created_at DESC
        `, [projectId, tenantId]),
        query(`
          SELECT pm.*, u.first_name, u.last_name, u.email, u.role
          FROM project_members pm
          JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = $1
          ORDER BY pm.joined_at ASC
        `, [projectId]),
        query(`SELECT id, first_name, last_name, email, role FROM users WHERE tenant_id = $1 AND is_active = TRUE`, [tenantId]),
      ]);

      const project = projectRes.rows[0];
      if (!project) {
        req.flash('error', 'Project not found.');
        res.redirect('/projects');
        return;
      }

      res.render('pages/projects/show', {
        title: project.name,
        project,
        tasks: tasksRes.rows,
        members: membersRes.rows,
        teamUsers: usersRes.rows,
        formatKES,
      });
    } catch (error) {
      projectLogger.error('Failed to show project', { error: String(error) });
      next(error);
    }
  };

  /**
   * Add a task to project
   */
  addTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const projectId = req.params.id as string;
      const { title, description, assignedToId, priority, estimatedHours, dueDate } = req.body;

      if (!tenantId || !title) {
        req.flash('error', 'Task title is required.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      await TaskModel.create({
        tenantId,
        projectId,
        title,
        description: description || null,
        assignedToId: assignedToId || null,
        priority: priority || TaskPriority.MEDIUM,
        status: TaskStatus.TODO,
        estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
      });

      req.flash('success', 'Task added successfully.');
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to add task', { error: String(error) });
      next(error);
    }
  };
}

export default new ProjectController();
