// ══════════════════════════════════════════════════════════════════════
// Project Controller - Raw PostgreSQL Queries
// Project lifecycle, tasks, and team assignments
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { query } from '../config/database';
import {
  ProjectModel,
  TaskModel,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  UserRole,
  AuditAction,
} from '../models';
import { SubscriptionModel } from '../models/subscription.model';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import storageService from '../services/storage.service';
import ActionLogService from '../services/actionLog.service';
import { formatKES } from '../utils/taxCalculator';
import { isAssignedProjectsOnly, hasModulePermission } from '../middleware/rbac';
import {
  classifyFile,
  matchesExpectedSignature,
  buildContentDisposition,
  extractTextPreview,
  extractSpreadsheetPreview,
  extractZipEntries,
  extractDocxParagraphs,
} from '../utils/filePreview';
import logger from '../utils/logger';

const projectLogger = logger.child('ProjectController');

const VALID_PROJECT_STATUSES = new Set<string>(Object.values(ProjectStatus));
const VALID_TASK_STATUSES = new Set<string>(Object.values(TaskStatus));
const VALID_TASK_PRIORITIES = new Set<string>(Object.values(TaskPriority));

function parseOptionalNonNegativeNumber(raw: unknown): { value: number | null; valid: boolean } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { value: null, valid: true };
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) {
    return { value: null, valid: false };
  }
  return { value: num, valid: true };
}

function parseOptionalDateInput(raw: unknown): { value: Date | null; valid: boolean } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { value: null, valid: true };
  }
  const d = new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) {
    return { value: null, valid: false };
  }
  return { value: d, valid: true };
}

export class ProjectController {
  /**
   * Verify user authentication, tenant ownership, and assigned-project scope.
   */
  private async verifyProjectAccess(
    req: Request,
    projectId: string
  ): Promise<{ project: any | null; isSuper: boolean; tenantId: string | undefined; denied: boolean }> {
    const isSuper = req.user?.role === UserRole.SUPER_ADMIN;
    const tenantId = req.tenantId;

    if (!tenantId && !isSuper) {
      return { project: null, isSuper, tenantId, denied: true };
    }

    const params: any[] = [projectId];
    const tenantFilter = !isSuper && tenantId ? (params.push(tenantId), ` AND p.tenant_id = $2`) : '';
    const projectRes = await query(
      `
        SELECT p.*, c.name as client_name, c.email as client_email, c.phone as client_phone
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        WHERE p.id = $1${tenantFilter}
        LIMIT 1
      `,
      params
    );

    const project = projectRes.rows[0] || null;
    if (!project) {
      return { project: null, isSuper, tenantId, denied: false };
    }

    if (req.user && isAssignedProjectsOnly(req.user)) {
      const assignedRes = await query(
        `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
         UNION
         SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2
         LIMIT 1`,
        [projectId, req.user.id]
      );
      if ((assignedRes.rowCount || 0) === 0) {
        return { project: null, isSuper, tenantId, denied: true };
      }
    }

    return { project, isSuper, tenantId: project.tenant_id, denied: false };
  }

  /**
   * Prevent read-only client portal accounts from mutating tasks unless explicitly granted manage access.
   */
  private canMutateTasks(req: Request): boolean {
    if (!req.user) return false;
    if (req.user.role === UserRole.CLIENT_PORTAL && !hasModulePermission(req.user, 'projects', 'manage')) {
      return false;
    }
    return true;
  }

  private async verifyTenantClient(clientId: string, tenantId: string): Promise<boolean> {
    const res = await query(`SELECT id FROM clients WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [clientId, tenantId]);
    return (res.rowCount || 0) > 0;
  }

  private async verifyTenantUser(userId: string, tenantId: string): Promise<boolean> {
    const res = await query(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [userId, tenantId]);
    return (res.rowCount || 0) > 0;
  }
  /**
   * List all projects for current tenant with pagination, search, and date filters
   */
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
        conditions.push(`p.tenant_id = $${paramIdx++}`);
        values.push(tenantId);
      }

      // Restrict to assigned projects if user has assigned-only scope
      if (req.user && isAssignedProjectsOnly(req.user)) {
        conditions.push(`(
          EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $${paramIdx})
          OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.assigned_to_id = $${paramIdx})
        )`);
        values.push(req.user.id);
        paramIdx++;
      }

      if (params.search) {
        conditions.push(`(
          p.name ILIKE $${paramIdx} OR
          p.code ILIKE $${paramIdx} OR
          c.name ILIKE $${paramIdx} OR
          p.description ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`p.created_at >= $${paramIdx++}::timestamptz`);
        values.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        conditions.push(`p.created_at <= $${paramIdx++}::timestamptz`);
        values.push(`${params.endDate}T23:59:59Z`);
      }

      if (params.status) {
        conditions.push(`p.status = $${paramIdx++}`);
        values.push(params.status);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total projects
      const countSql = `
        SELECT COUNT(*)::int as total
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        ${whereClause}
      `;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

      // Select projects with task and member counts - newest at top (p.created_at DESC)
      const dataSql = `
        SELECT 
          p.*,
          c.name as client_name,
          (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id) as task_count,
          (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'COMPLETED') as completed_task_count,
          (SELECT COUNT(*)::int FROM project_members pm WHERE pm.project_id = p.id) as member_count
        FROM projects p
        LEFT JOIN clients c ON p.client_id = c.id
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];
      const result = await query(dataSql, dataValues);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/projects/index', {
        title: 'Projects',
        projects: result.rows,
        pagination,
        filters: params,
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
      if (tenantId) {
        const limitCheck = await SubscriptionModel.checkTenantResourceLimit(tenantId, 'projects');
        if (!limitCheck.allowed) {
          req.flash('error', limitCheck.message || 'Project limit reached for your subscription package.');
          res.redirect('/projects');
          return;
        }
      }

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

      // Enforce subscription project limit
      const limitCheck = await SubscriptionModel.checkTenantResourceLimit(tenantId, 'projects');
      if (!limitCheck.allowed) {
        req.flash('error', limitCheck.message || 'Project limit reached for your subscription package.');
        res.redirect('/projects');
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

      // Record Action Log
      await ActionLogService.record(req, {
        action: AuditAction.CREATE,
        entityType: 'PROJECT',
        entityId: project.id,
        description: `Created new project "${project.name}" (${project.code})`,
        metadata: { name: project.name, code: project.code, budget: project.budget },
      });

      req.flash('success', `Project "${project.name}" (${project.code}) created successfully.`);
      res.redirect(`/projects/${project.id}`);
    } catch (error) {
      projectLogger.error('Failed to create project', { error: String(error) });
      next(error);
    }
  };

  /**
   * Render edit project form
   */
  showEdit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        req.flash('error', access.denied ? 'You do not have permission to edit this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      const clientsRes = await query(
        `SELECT * FROM clients WHERE tenant_id = $1 AND (is_active = TRUE OR id = $2) ORDER BY name ASC`,
        [access.project.tenant_id, access.project.client_id || null]
      );

      res.render('pages/projects/edit', {
        title: `Edit ${access.project.name}`,
        project: access.project,
        clients: clientsRes.rows,
      });
    } catch (error) {
      projectLogger.error('Failed to load edit project form', { error: String(error) });
      next(error);
    }
  };

  /**
   * Update an existing project
   */
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        req.flash('error', access.denied ? 'You do not have permission to edit this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      const existing = access.project;
      const effectiveTenantId: string = existing.tenant_id;
      const { name, code, clientId, description, budget, startDate, endDate, status } = req.body;

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      const trimmedCode = typeof code === 'string' ? code.trim() : '';
      if (!trimmedName || !trimmedCode) {
        req.flash('error', 'Project Name and Project Code are required.');
        res.redirect(`/projects/${projectId}/edit`);
        return;
      }

      const normalizedStatus = VALID_PROJECT_STATUSES.has(status)
        ? (status as ProjectStatus)
        : (existing.status as ProjectStatus);

      const cleanClientId = clientId && String(clientId).trim() !== '' ? String(clientId).trim() : null;
      if (cleanClientId && !(await this.verifyTenantClient(cleanClientId, effectiveTenantId))) {
        req.flash('error', 'Selected client does not belong to this organization.');
        res.redirect(`/projects/${projectId}/edit`);
        return;
      }

      const parsedBudget = parseOptionalNonNegativeNumber(budget);
      if (!parsedBudget.valid) {
        req.flash('error', 'Budget must be a valid non-negative number.');
        res.redirect(`/projects/${projectId}/edit`);
        return;
      }

      const parsedStart = parseOptionalDateInput(startDate);
      const parsedEnd = parseOptionalDateInput(endDate);
      if (!parsedStart.valid || !parsedEnd.valid) {
        req.flash('error', 'Please enter valid start and end dates.');
        res.redirect(`/projects/${projectId}/edit`);
        return;
      }

      if (parsedStart.value && parsedEnd.value && parsedEnd.value < parsedStart.value) {
        req.flash('error', 'Target End Date cannot be earlier than Start Date.');
        res.redirect(`/projects/${projectId}/edit`);
        return;
      }

      const duplicate = await ProjectModel.findByTenantAndCodeExcludingId(
        effectiveTenantId,
        trimmedCode,
        projectId
      );
      if (duplicate) {
        req.flash('error', `Another project with code "${trimmedCode}" already exists.`);
        res.redirect(`/projects/${projectId}/edit`);
        return;
      }

      const completedAt =
        normalizedStatus === ProjectStatus.COMPLETED
          ? (existing.completed_at ? new Date(existing.completed_at) : new Date())
          : null;

      const updated = await ProjectModel.update(projectId, access.isSuper ? null : effectiveTenantId, {
        clientId: cleanClientId,
        name: trimmedName,
        code: trimmedCode,
        description: typeof description === 'string' && description.trim() !== '' ? description.trim() : null,
        status: normalizedStatus,
        budget: parsedBudget.value,
        startDate: parsedStart.value,
        endDate: parsedEnd.value,
        completedAt,
      });

      if (!updated) {
        req.flash('error', 'Project could not be updated.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'PROJECT',
        entityId: projectId,
        description: `Updated project "${updated.name}" (${updated.code})`,
        metadata: {
          before: {
            name: existing.name,
            code: existing.code,
            status: existing.status,
            budget: existing.budget,
            clientId: existing.client_id,
          },
          after: {
            name: updated.name,
            code: updated.code,
            status: updated.status,
            budget: updated.budget,
            clientId: updated.clientId,
          },
        },
      });

      req.flash('success', `Project "${updated.name}" updated successfully.`);
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to update project', { error: String(error) });
      next(error);
    }
  };

  /**
   * Show project detail with tasks and members
   */
  show = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        req.flash('error', access.denied ? 'You do not have permission to access this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      const project = access.project;
      const effectiveTenantId = project.tenant_id;

      const [tasksRes, membersRes, usersRes, docsRes, invoicesRes, quotationsRes, expensesRes] = await Promise.all([
        query(`
          SELECT t.*, u.first_name, u.last_name, u.avatar_url
          FROM tasks t
          LEFT JOIN users u ON t.assigned_to_id = u.id
          WHERE t.project_id = $1 AND t.tenant_id = $2
          ORDER BY CASE WHEN t.status = 'COMPLETED' THEN 1 ELSE 0 END ASC, t.created_at DESC
        `, [projectId, effectiveTenantId]),
        query(`
          SELECT pm.*, u.first_name, u.last_name, u.email, u.phone, u.role as user_global_role
          FROM project_members pm
          JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = $1
          ORDER BY pm.joined_at ASC
        `, [projectId]),
        query(`SELECT id, first_name, last_name, email, role FROM users WHERE tenant_id = $1 AND is_active = TRUE ORDER BY first_name ASC`, [effectiveTenantId]),
        query(`
          SELECT pd.*, u.first_name, u.last_name
          FROM project_documents pd
          LEFT JOIN users u ON pd.uploaded_by_id = u.id
          WHERE pd.project_id = $1 AND pd.tenant_id = $2
          ORDER BY pd.created_at DESC
        `, [projectId, effectiveTenantId]),
        query(`
          SELECT i.*, c.name as client_name
          FROM invoices i
          LEFT JOIN clients c ON i.client_id = c.id
          WHERE i.project_id = $1 AND i.tenant_id = $2
          ORDER BY i.created_at DESC
        `, [projectId, effectiveTenantId]),
        query(`
          SELECT q.*, c.name as client_name
          FROM quotations q
          LEFT JOIN clients c ON q.client_id = c.id
          WHERE q.project_id = $1 AND q.tenant_id = $2
          ORDER BY q.created_at DESC
        `, [projectId, effectiveTenantId]),
        query(`
          SELECT e.*
          FROM expenses e
          WHERE e.project_id = $1 AND e.tenant_id = $2
          ORDER BY e.expense_date DESC
          LIMIT 20
        `, [projectId, effectiveTenantId]),
      ]);

      // Build full teamMembers list
      const teamMembers = membersRes.rows.map((m: any) => ({
        id: m.id,
        user_id: m.user_id,
        first_name: m.first_name,
        last_name: m.last_name,
        email: m.email,
        phone: m.phone,
        role: m.user_global_role || m.role,
        project_role: m.role_in_project || 'Contributor',
        joined_at: m.joined_at,
        source: 'member',
      }));

      // Also include any task assignees
      const existingUserIds = new Set(teamMembers.map((m: any) => m.user_id));
      tasksRes.rows.forEach((t: any) => {
        if (t.assigned_to_id && !existingUserIds.has(t.assigned_to_id) && t.first_name) {
          teamMembers.push({
            id: t.id,
            user_id: t.assigned_to_id,
            first_name: t.first_name,
            last_name: t.last_name,
            email: t.email || '',
            phone: t.phone || '',
            role: 'TEAM_MEMBER',
            project_role: 'Task Assignee',
            joined_at: t.created_at,
            source: 'task',
          });
          existingUserIds.add(t.assigned_to_id);
        }
      });

      res.render('pages/projects/show', {
        title: project.name,
        project,
        tasks: tasksRes.rows,
        members: membersRes.rows,
        teamMembers,
        availableUsers: usersRes.rows,
        teamUsers: usersRes.rows,
        documents: docsRes.rows,
        invoices: invoicesRes.rows,
        quotations: quotationsRes.rows,
        expenses: expensesRes.rows,
        canModifyTasks: this.canMutateTasks(req),
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
      const projectId = String(req.params.id);
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        req.flash('error', access.denied ? 'You do not have permission to add tasks to this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      if (!this.canMutateTasks(req)) {
        req.flash('error', 'You do not have permission to modify tasks in this project.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const { title, description, assignedToId, priority, estimatedHours, dueDate } = req.body;
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';

      if (!trimmedTitle) {
        req.flash('error', 'Task title is required.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const effectiveTenantId: string = access.project.tenant_id;
      const cleanAssignee = assignedToId && String(assignedToId).trim() !== '' ? String(assignedToId).trim() : null;
      if (cleanAssignee && !(await this.verifyTenantUser(cleanAssignee, effectiveTenantId))) {
        req.flash('error', 'Selected assignee does not belong to this organization.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const parsedHours = parseOptionalNonNegativeNumber(estimatedHours);
      if (!parsedHours.valid) {
        req.flash('error', 'Estimated hours must be a valid non-negative number.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const parsedDue = parseOptionalDateInput(dueDate);
      if (!parsedDue.valid) {
        req.flash('error', 'Please provide a valid task due date.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const normalizedPriority = VALID_TASK_PRIORITIES.has(priority)
        ? (priority as TaskPriority)
        : TaskPriority.MEDIUM;

      const createdTask = await TaskModel.create({
        tenantId: effectiveTenantId,
        projectId,
        title: trimmedTitle,
        description: typeof description === 'string' && description.trim() !== '' ? description.trim() : null,
        assignedToId: cleanAssignee,
        priority: normalizedPriority,
        status: TaskStatus.TODO,
        estimatedHours: parsedHours.value,
        dueDate: parsedDue.value,
      });

      await ActionLogService.record(req, {
        action: AuditAction.CREATE,
        entityType: 'TASK',
        entityId: createdTask.id,
        description: `Created task "${createdTask.title}" in project "${access.project.name}"`,
        metadata: {
          projectId,
          taskId: createdTask.id,
          priority: createdTask.priority,
          assignedToId: createdTask.assignedToId,
        },
      });

      req.flash('success', 'Task added successfully.');
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to add task', { error: String(error) });
      next(error);
    }
  };

  /**
   * Edit an existing task in a project
   */
  updateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const taskId = String(req.params.taskId);
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        req.flash('error', access.denied ? 'You do not have permission to edit tasks in this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      if (!this.canMutateTasks(req)) {
        req.flash('error', 'You do not have permission to edit tasks in this project.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const effectiveTenantId: string = access.project.tenant_id;
      const existingTask = await TaskModel.findByIdAndProject(
        taskId,
        projectId,
        access.isSuper ? null : effectiveTenantId
      );

      if (!existingTask) {
        req.flash('error', 'Task not found.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const { title, description, assignedToId, priority, status, dueDate, estimatedHours, actualHours } = req.body;
      const trimmedTitle = typeof title === 'string' ? title.trim() : '';

      if (!trimmedTitle) {
        req.flash('error', 'Task title is required.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const normalizedStatus = VALID_TASK_STATUSES.has(status)
        ? (status as TaskStatus)
        : existingTask.status;
      const normalizedPriority = VALID_TASK_PRIORITIES.has(priority)
        ? (priority as TaskPriority)
        : existingTask.priority;

      const cleanAssignee = assignedToId && String(assignedToId).trim() !== '' ? String(assignedToId).trim() : null;
      if (cleanAssignee && !(await this.verifyTenantUser(cleanAssignee, effectiveTenantId))) {
        req.flash('error', 'Selected assignee does not belong to this organization.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const parsedEstHours = parseOptionalNonNegativeNumber(estimatedHours);
      const parsedActHours = parseOptionalNonNegativeNumber(actualHours);
      if (!parsedEstHours.valid || !parsedActHours.valid) {
        req.flash('error', 'Estimated and actual hours must be valid non-negative numbers.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const parsedDue = parseOptionalDateInput(dueDate);
      if (!parsedDue.valid) {
        req.flash('error', 'Please enter a valid due date.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const completedAt =
        normalizedStatus === TaskStatus.COMPLETED
          ? (existingTask.completedAt || new Date())
          : null;

      const updatedTask = await TaskModel.update(
        taskId,
        projectId,
        access.isSuper ? null : effectiveTenantId,
        {
          assignedToId: cleanAssignee,
          title: trimmedTitle,
          description: typeof description === 'string' && description.trim() !== '' ? description.trim() : null,
          status: normalizedStatus,
          priority: normalizedPriority,
          estimatedHours: parsedEstHours.value,
          actualHours: parsedActHours.value,
          dueDate: parsedDue.value,
          completedAt,
        }
      );

      if (!updatedTask) {
        req.flash('error', 'Failed to update task.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'TASK',
        entityId: taskId,
        description: `Updated task "${updatedTask.title}" in project "${access.project.name}"`,
        metadata: {
          projectId,
          taskId,
          before: {
            title: existingTask.title,
            status: existingTask.status,
            priority: existingTask.priority,
            assignedToId: existingTask.assignedToId,
          },
          after: {
            title: updatedTask.title,
            status: updatedTask.status,
            priority: updatedTask.priority,
            assignedToId: updatedTask.assignedToId,
          },
        },
      });

      req.flash('success', `Task "${updatedTask.title}" updated successfully.`);
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to update task', { error: String(error) });
      next(error);
    }
  };

  /**
   * Quickly update a task's status (e.g. Mark as Complete, In Progress, Reopen, Blocked)
   */
  updateTaskStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const taskId = String(req.params.taskId);
      const wantsJson = Boolean(req.xhr || req.headers.accept?.includes('application/json'));
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        if (wantsJson) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        if (wantsJson) {
          res.status(access.denied ? 403 : 404).json({ error: access.denied ? 'Access denied' : 'Project not found' });
          return;
        }
        req.flash('error', access.denied ? 'You do not have permission to update tasks in this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      if (!this.canMutateTasks(req)) {
        if (wantsJson) {
          res.status(403).json({ error: 'Permission denied' });
          return;
        }
        req.flash('error', 'You do not have permission to update task status.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const nextStatus = String(req.body.status || '').trim();
      if (!VALID_TASK_STATUSES.has(nextStatus)) {
        if (wantsJson) {
          res.status(400).json({ error: 'Invalid task status' });
          return;
        }
        req.flash('error', 'Invalid task status.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const effectiveTenantId: string = access.project.tenant_id;
      const existingTask = await TaskModel.findByIdAndProject(
        taskId,
        projectId,
        access.isSuper ? null : effectiveTenantId
      );
      if (!existingTask) {
        if (wantsJson) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }
        req.flash('error', 'Task not found.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const updatedTask = await TaskModel.updateStatus(
        taskId,
        projectId,
        access.isSuper ? null : effectiveTenantId,
        nextStatus as TaskStatus
      );

      if (!updatedTask) {
        if (wantsJson) {
          res.status(500).json({ error: 'Failed to update task status' });
          return;
        }
        req.flash('error', 'Failed to update task status.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'TASK',
        entityId: taskId,
        description: `Changed task "${updatedTask.title}" status from ${existingTask.status} to ${updatedTask.status} in project "${access.project.name}"`,
        metadata: {
          projectId,
          taskId,
          previousStatus: existingTask.status,
          newStatus: updatedTask.status,
        },
      });

      if (wantsJson) {
        res.json({ success: true, task: updatedTask });
        return;
      }

      const statusLabels: Record<string, string> = {
        TODO: 'To Do',
        IN_PROGRESS: 'In Progress',
        IN_REVIEW: 'In Review',
        COMPLETED: 'Completed',
        BLOCKED: 'Blocked',
      };
      req.flash('success', `Task "${updatedTask.title}" marked as ${statusLabels[updatedTask.status] || updatedTask.status}.`);
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to update task status', { error: String(error) });
      next(error);
    }
  };

  /**
   * Upload project document to Cloudflare R2
   */
  uploadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        req.flash('error', access.denied ? 'You do not have permission to upload files to this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      if (!this.canMutateTasks(req)) {
        req.flash('error', 'You do not have permission to upload files to this project.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      if (!req.file) {
        req.flash('error', 'Please select a file to upload.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const effectiveTenantId: string = access.project.tenant_id;
      const uploadResult = await storageService.uploadTenantFile(effectiveTenantId, req.file, `projects/${projectId}`);
      const documentName = req.body.documentName?.trim() || req.file.originalname;

      await query(`
        INSERT INTO project_documents (
          id, tenant_id, project_id, name, file_url, file_size, file_type, uploaded_by_id, created_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW()
        )
      `, [
        effectiveTenantId,
        projectId,
        documentName,
        uploadResult.url,
        req.file.size,
        req.file.mimetype,
        req.user?.id || null,
      ]);

      // Record Action Log
      await ActionLogService.record(req, {
        action: AuditAction.CREATE,
        entityType: 'PROJECT_DOCUMENT',
        entityId: projectId,
        description: `Uploaded file "${documentName}" to project`,
        metadata: {
          documentName,
          fileSize: req.file.size,
          storageType: uploadResult.storageType,
          url: uploadResult.url,
        },
      });

      req.flash('success', `File "${documentName}" uploaded successfully.`);
      res.redirect(`/projects/${projectId}`);
    } catch (error: any) {
      projectLogger.error('Failed to upload project document', { error: String(error) });
      req.flash('error', error?.message || 'Failed to upload document.');
      res.redirect(`/projects/${req.params.id}`);
    }
  };

  /**
   * Helper to authorize and load a project document + its storage bytes
   */
  private async fetchAuthorizedDocument(
    req: Request,
    projectId: string,
    docId: string
  ): Promise<{
    statusCode: number;
    error?: string;
    project?: any;
    doc?: any;
    buffer?: Buffer;
  }> {
    const access = await this.verifyProjectAccess(req, projectId);
    if (access.denied && !req.tenantId && !access.isSuper) {
      return { statusCode: 401, error: 'Authentication required.' };
    }
    if (!access.project) {
      return {
        statusCode: access.denied ? 403 : 404,
        error: access.denied ? 'You do not have permission to access this project.' : 'Project not found.',
      };
    }

    const docRes = await query(
      `SELECT pd.*, u.first_name, u.last_name
       FROM project_documents pd
       LEFT JOIN users u ON pd.uploaded_by_id = u.id
       WHERE pd.id = $1 AND pd.project_id = $2 AND pd.tenant_id = $3
       LIMIT 1`,
      [docId, projectId, access.project.tenant_id]
    );

    const doc = docRes.rows[0];
    if (!doc) {
      return { statusCode: 404, error: 'Document not found.' };
    }

    const fileData = await storageService.getFileBuffer(doc.file_url);
    if (!fileData) {
      return { statusCode: 404, error: 'File contents could not be retrieved from storage.' };
    }

    return {
      statusCode: 200,
      project: access.project,
      doc,
      buffer: fileData.buffer,
    };
  }

  private resolveEffectiveFilename(doc: any, extension: string): string {
    const rawName = String(doc?.name || 'document');
    const hasExt = Boolean(path.posix.extname(rawName.replace(/\\/g, '/')));
    return !hasExt && extension ? `${rawName}${extension}` : rawName;
  }

  /**
   * Stream project document inline for in-app PDF/Image/Text preview (same-origin, CSP-safe)
   */
  previewDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const docId = String(req.params.docId);
      const result = await this.fetchAuthorizedDocument(req, projectId, docId);

      if (!result.doc || !result.buffer) {
        res.status(result.statusCode).send(result.error || 'Unable to load file.');
        return;
      }

      const { doc, buffer } = result;
      const classification = classifyFile(doc.name, doc.file_type, doc.file_url);
      const effectiveName = this.resolveEffectiveFilename(doc, classification.extension);
      const signatureValid = matchesExpectedSignature(buffer, classification);

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');

      if (signatureValid && classification.kind === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', buildContentDisposition('inline', effectiveName));
        res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'self'; frame-ancestors 'self'");
        res.send(buffer);
        return;
      }

      if (signatureValid && classification.kind === 'image') {
        res.setHeader('Content-Type', classification.safeContentType);
        res.setHeader('Content-Disposition', buildContentDisposition('inline', effectiveName));
        res.setHeader(
          'Content-Security-Policy',
          classification.isSvg
            ? "default-src 'none'; style-src 'unsafe-inline'; sandbox"
            : "default-src 'none'"
        );
        res.send(buffer);
        return;
      }

      if (classification.kind === 'text' || (classification.kind === 'spreadsheet' && classification.extension === '.csv')) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', buildContentDisposition('inline', effectiveName));
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        res.send(buffer);
        return;
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', buildContentDisposition('attachment', effectiveName));
      res.send(buffer);
    } catch (error) {
      projectLogger.error('Failed to preview project document', { error: String(error) });
      next(error);
    }
  };

  /**
   * Return structured JSON preview metadata/contents for spreadsheets, DOCX, text, ZIP, PDF, and images
   */
  previewDocumentData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const docId = String(req.params.docId);
      const result = await this.fetchAuthorizedDocument(req, projectId, docId);

      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');

      if (!result.doc || !result.buffer) {
        res.status(result.statusCode).json({ error: result.error || 'Document unavailable.' });
        return;
      }

      const { doc, buffer } = result;
      const classification = classifyFile(doc.name, doc.file_type, doc.file_url);
      const effectiveName = this.resolveEffectiveFilename(doc, classification.extension);
      const signatureValid = matchesExpectedSignature(buffer, classification);

      const basePayload = {
        fileName: effectiveName,
        displayName: doc.name,
        mimeType: doc.file_type || classification.safeContentType,
        fileSize: doc.file_size || buffer.length,
        previewUrl: `/projects/${projectId}/documents/${docId}/preview`,
        downloadUrl: `/projects/${projectId}/documents/${docId}/download`,
      };

      if ((classification.kind === 'pdf' || classification.kind === 'image') && !signatureValid) {
        res.json({
          ...basePayload,
          kind: 'unsupported',
          message: 'This file header does not match its declared format and cannot be previewed inline. Please download it safely to inspect.',
        });
        return;
      }

      if (classification.kind === 'pdf') {
        res.json({ ...basePayload, kind: 'pdf' });
        return;
      }

      if (classification.kind === 'image') {
        res.json({ ...basePayload, kind: 'image', isSvg: classification.isSvg });
        return;
      }

      if (classification.kind === 'text') {
        const textPreview = extractTextPreview(buffer);
        res.json({
          ...basePayload,
          kind: 'text',
          text: textPreview.text,
          truncated: textPreview.truncated,
        });
        return;
      }

      if (classification.kind === 'spreadsheet') {
        try {
          const sheets = extractSpreadsheetPreview(buffer, classification.extension === '.csv');
          res.json({
            ...basePayload,
            kind: 'spreadsheet',
            sheets,
          });
        } catch {
          res.json({
            ...basePayload,
            kind: 'unsupported',
            message: 'Unable to parse spreadsheet for inline preview. You can download the file to view it.',
          });
        }
        return;
      }

      if (classification.kind === 'docx') {
        try {
          const paragraphs = extractDocxParagraphs(buffer);
          res.json({
            ...basePayload,
            kind: 'docx',
            paragraphs,
          });
        } catch {
          res.json({
            ...basePayload,
            kind: 'unsupported',
            message: 'Unable to extract text preview from this Word document. Please download it to open locally.',
          });
        }
        return;
      }

      if (classification.kind === 'zip') {
        const entries = extractZipEntries(buffer);
        res.json({
          ...basePayload,
          kind: 'zip',
          entries,
        });
        return;
      }

      res.json({
        ...basePayload,
        kind: 'unsupported',
        message: 'In-app preview is not available for this file format. Use the Download button to open it on your device.',
      });
    } catch (error) {
      projectLogger.error('Failed to generate document preview data', { error: String(error) });
      next(error);
    }
  };

  /**
   * Download project document safely as an attachment via authenticated same-origin route
   */
  downloadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const docId = String(req.params.docId);
      const result = await this.fetchAuthorizedDocument(req, projectId, docId);

      if (!result.doc || !result.buffer) {
        req.flash('error', result.error || 'Document could not be downloaded.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const classification = classifyFile(result.doc.name, result.doc.file_type, result.doc.file_url);
      const effectiveName = this.resolveEffectiveFilename(result.doc, classification.extension);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', buildContentDisposition('attachment', effectiveName));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(result.buffer);
    } catch (error) {
      projectLogger.error('Failed to download project document', { error: String(error) });
      next(error);
    }
  };

  /**
   * Delete project document
   */
  deleteDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = String(req.params.id);
      const docId = String(req.params.docId);
      const access = await this.verifyProjectAccess(req, projectId);

      if (access.denied && !req.tenantId && !access.isSuper) {
        res.redirect('/auth/login');
        return;
      }

      if (!access.project) {
        req.flash('error', access.denied ? 'You do not have permission to delete files from this project.' : 'Project not found.');
        res.redirect('/projects');
        return;
      }

      const docRes = await query(`
        SELECT * FROM project_documents WHERE id = $1 AND project_id = $2 AND tenant_id = $3
      `, [docId, projectId, access.project.tenant_id]);

      const doc = docRes.rows[0];
      if (doc) {
        await storageService.deleteFile(doc.file_url);
        await query(`DELETE FROM project_documents WHERE id = $1`, [docId]);

        // Record Action Log
        await ActionLogService.record(req, {
          action: AuditAction.DELETE,
          entityType: 'PROJECT_DOCUMENT',
          entityId: projectId,
          description: `Deleted document "${doc.name}" from project`,
          metadata: { docId, documentName: doc.name },
        });

        req.flash('success', 'Document deleted successfully.');
      } else {
        req.flash('error', 'Document not found.');
      }
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to delete project document', { error: String(error) });
      next(error);
    }
  };

  /**
   * Assign a team member to the project
   */
  addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const projectId = req.params.id as string;
      const { userId, roleInProject, role, projectRole, rateType, rate } = req.body;
      const assignedRole = (roleInProject || role || projectRole || 'Contributor').trim();

      if (!tenantId || !userId) {
        req.flash('error', 'Please select a team member to assign.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      // Check project belongs to tenant
      const pCheck = await query('SELECT id, name FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, tenantId]);
      if (!pCheck.rows[0]) {
        req.flash('error', 'Project not found.');
        res.redirect('/projects');
        return;
      }

      // Check user belongs to same tenant
      const uCheck = await query('SELECT id, first_name, last_name FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);
      if (!uCheck.rows[0]) {
        req.flash('error', 'Selected user was not found in your organization.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      await query(`
        INSERT INTO project_members (
          id, project_id, user_id, role_in_project, rate_type, rate, joined_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, NOW()
        )
        ON CONFLICT (project_id, user_id) 
        DO UPDATE SET 
          role_in_project = EXCLUDED.role_in_project,
          rate_type = EXCLUDED.rate_type,
          rate = EXCLUDED.rate
      `, [
        projectId,
        userId,
        assignedRole,
        rateType || 'hourly',
        rate ? parseFloat(rate) : null,
      ]);

      await ActionLogService.record(req, {
        action: AuditAction.CREATE,
        entityType: 'PROJECT_MEMBER',
        entityId: projectId,
        description: `Assigned ${uCheck.rows[0].first_name} ${uCheck.rows[0].last_name} to project "${pCheck.rows[0].name}"`,
        metadata: { projectId, userId, roleInProject },
      });

      req.flash('success', `${uCheck.rows[0].first_name} ${uCheck.rows[0].last_name} assigned to project successfully.`);
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to add project member', { error: String(error) });
      next(error);
    }
  };

  /**
   * Remove a member from the project
   */
  removeMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const projectId = req.params.id as string;
      const memberId = req.params.memberId as string;

      // Check project belongs to tenant
      const pCheck = await query('SELECT id, name FROM projects WHERE id = $1 AND tenant_id = $2', [projectId, tenantId]);
      if (!pCheck.rows[0]) {
        req.flash('error', 'Project not found.');
        res.redirect('/projects');
        return;
      }

      await query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, memberId]);

      await ActionLogService.record(req, {
        action: AuditAction.DELETE,
        entityType: 'PROJECT_MEMBER',
        entityId: projectId,
        description: `Removed member ${memberId} from project "${pCheck.rows[0].name}"`,
        metadata: { projectId, memberId },
      });

      req.flash('success', 'Team member removed from project.');
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to remove project member', { error: String(error) });
      next(error);
    }
  };

  /**
   * Delete a task from the project with persistent audit logging
   */
  deleteTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const projectId = req.params.id as string;
      const taskId = req.params.taskId as string;

      // Check project
      const pCheck = await query('SELECT id, name FROM projects WHERE id = $1' + (tenantId && !isSuper ? ' AND tenant_id = $2' : ''), tenantId && !isSuper ? [projectId, tenantId] : [projectId]);
      const project = pCheck.rows[0];
      if (!project) {
        req.flash('error', 'Project not found.');
        res.redirect('/projects');
        return;
      }

      // Fetch task details for audit log
      const tCheck = await query('SELECT * FROM tasks WHERE id = $1 AND project_id = $2' + (tenantId && !isSuper ? ' AND tenant_id = $3' : ''), tenantId && !isSuper ? [taskId, projectId, tenantId] : [taskId, projectId]);
      const task = tCheck.rows[0];
      if (!task) {
        req.flash('error', 'Task not found.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      // Record audit log BEFORE deletion so full audit history is preserved in audit_logs
      await ActionLogService.record(req, {
        action: AuditAction.DELETE,
        entityType: 'TASK',
        entityId: taskId,
        description: `Deleted task "${task.title}" in project "${project.name}"`,
        metadata: {
          taskId,
          title: task.title,
          description: task.description,
          projectId,
          projectName: project.name,
          priority: task.priority,
          status: task.status,
          assignedToId: task.assigned_to_id,
          estimatedHours: task.estimated_hours,
          dueDate: task.due_date,
        },
      });

      // Delete task from database
      await query('DELETE FROM tasks WHERE id = $1', [taskId]);

      req.flash('success', `Task "${task.title}" deleted successfully. Audit trail preserved.`);
      res.redirect(`/projects/${projectId}`);
    } catch (error) {
      projectLogger.error('Failed to delete task', { error: String(error) });
      next(error);
    }
  };

  /**
   * Delete a project with persistent audit logging
   */
  deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const projectId = req.params.id as string;

      const pCheck = await query('SELECT * FROM projects WHERE id = $1' + (tenantId && !isSuper ? ' AND tenant_id = $2' : ''), tenantId && !isSuper ? [projectId, tenantId] : [projectId]);
      const project = pCheck.rows[0];
      if (!project) {
        req.flash('error', 'Project not found.');
        res.redirect('/projects');
        return;
      }

      // Count tasks, documents, and members for audit metadata
      const taskCountRes = await query('SELECT COUNT(*)::int as count FROM tasks WHERE project_id = $1', [projectId]);
      const docCountRes = await query('SELECT COUNT(*)::int as count FROM project_documents WHERE project_id = $1', [projectId]);
      const memberCountRes = await query('SELECT COUNT(*)::int as count FROM project_members WHERE project_id = $1', [projectId]);

      // Record audit log BEFORE deletion so full audit history is preserved in audit_logs
      await ActionLogService.record(req, {
        action: AuditAction.DELETE,
        entityType: 'PROJECT',
        entityId: projectId,
        description: `Deleted project "${project.name}" (${project.code})`,
        metadata: {
          projectId,
          name: project.name,
          code: project.code,
          clientId: project.client_id,
          budget: project.budget,
          status: project.status,
          startDate: project.start_date,
          endDate: project.end_date,
          taskCount: taskCountRes.rows[0]?.count || 0,
          documentCount: docCountRes.rows[0]?.count || 0,
          memberCount: memberCountRes.rows[0]?.count || 0,
        },
      });

      // Cleanup project documents from storage if any
      const docsRes = await query('SELECT file_url FROM project_documents WHERE project_id = $1', [projectId]);
      for (const d of docsRes.rows) {
        try {
          if (d.file_url) await storageService.deleteFile(d.file_url);
        } catch {}
      }
      await query('DELETE FROM project_documents WHERE project_id = $1', [projectId]);

      // Unlink or clean dependencies
      await query('DELETE FROM project_members WHERE project_id = $1', [projectId]);
      await query('DELETE FROM tasks WHERE project_id = $1', [projectId]);
      await query('UPDATE quotations SET project_id = NULL WHERE project_id = $1', [projectId]);
      await query('UPDATE invoices SET project_id = NULL WHERE project_id = $1', [projectId]);
      await query('UPDATE expenses SET project_id = NULL WHERE project_id = $1', [projectId]);
      await query('UPDATE maintenance_schedules SET project_id = NULL WHERE project_id = $1', [projectId]);

      // Delete project row
      await query('DELETE FROM projects WHERE id = $1', [projectId]);

      req.flash('success', `Project "${project.name}" deleted successfully. Audit trail preserved.`);
      res.redirect('/projects');
    } catch (error) {
      projectLogger.error('Failed to delete project', { error: String(error) });
      next(error);
    }
  };
}

export default new ProjectController();
