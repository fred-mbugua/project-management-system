// ══════════════════════════════════════════════════════════════════════
// Project Controller - Raw PostgreSQL Queries
// Project lifecycle, tasks, and team assignments
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ProjectModel, TaskModel, ProjectStatus, TaskPriority, TaskStatus, AuditAction } from '../models';
import { SubscriptionModel } from '../models/subscription.model';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import storageService from '../services/storage.service';
import ActionLogService from '../services/actionLog.service';
import { formatKES } from '../utils/taxCalculator';
import { isAssignedProjectsOnly } from '../middleware/rbac';
import logger from '../utils/logger';

const projectLogger = logger.child('ProjectController');

export class ProjectController {
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
   * Show project detail with tasks and members
   */
  show = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const projectId = req.params.id as string;

      const [projectRes, tasksRes, membersRes, usersRes, docsRes, invoicesRes, quotationsRes, expensesRes] = await Promise.all([
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
          SELECT pm.*, u.first_name, u.last_name, u.email, u.phone, u.role as user_global_role
          FROM project_members pm
          JOIN users u ON pm.user_id = u.id
          WHERE pm.project_id = $1
          ORDER BY pm.joined_at ASC
        `, [projectId]),
        query(`SELECT id, first_name, last_name, email, role FROM users WHERE tenant_id = $1 AND is_active = TRUE ORDER BY first_name ASC`, [tenantId]),
        query(`
          SELECT pd.*, u.first_name, u.last_name
          FROM project_documents pd
          LEFT JOIN users u ON pd.uploaded_by_id = u.id
          WHERE pd.project_id = $1 AND pd.tenant_id = $2
          ORDER BY pd.created_at DESC
        `, [projectId, tenantId]),
        query(`
          SELECT i.*, c.name as client_name
          FROM invoices i
          LEFT JOIN clients c ON i.client_id = c.id
          WHERE i.project_id = $1 AND i.tenant_id = $2
          ORDER BY i.created_at DESC
        `, [projectId, tenantId]),
        query(`
          SELECT q.*, c.name as client_name
          FROM quotations q
          LEFT JOIN clients c ON q.client_id = c.id
          WHERE q.project_id = $1 AND q.tenant_id = $2
          ORDER BY q.created_at DESC
        `, [projectId, tenantId]),
        query(`
          SELECT e.*
          FROM expenses e
          WHERE e.project_id = $1 AND e.tenant_id = $2
          ORDER BY e.expense_date DESC
          LIMIT 20
        `, [projectId, tenantId]),
      ]);

      const project = projectRes.rows[0];
      if (!project) {
        req.flash('error', 'Project not found.');
        res.redirect('/projects');
        return;
      }

      // If user is restricted to assigned projects only, verify project membership
      if (req.user && isAssignedProjectsOnly(req.user)) {
        const isAssigned = membersRes.rows.some((m: any) => m.user_id === req.user?.id) ||
                           tasksRes.rows.some((t: any) => t.assigned_to_id === req.user?.id);
        if (!isAssigned) {
          req.flash('error', 'You do not have permission to access this project.');
          res.redirect('/projects');
          return;
        }
      }

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

      if (req.user && isAssignedProjectsOnly(req.user)) {
        const isAssignedRes = await query(
          `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
           UNION
           SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2`,
          [projectId, req.user.id]
        );
        if (isAssignedRes.rowCount === 0) {
          req.flash('error', 'You do not have permission to add tasks to this project.');
          res.redirect('/projects');
          return;
        }
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

  /**
   * Upload project document to Cloudflare R2
   */
  uploadDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const projectId = req.params.id as string;
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      if (req.user && isAssignedProjectsOnly(req.user)) {
        const isAssignedRes = await query(
          `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2
           UNION
           SELECT 1 FROM tasks WHERE project_id = $1 AND assigned_to_id = $2`,
          [projectId, req.user.id]
        );
        if (isAssignedRes.rowCount === 0) {
          req.flash('error', 'You do not have permission to upload files to this project.');
          res.redirect('/projects');
          return;
        }
      }

      if (!req.file) {
        req.flash('error', 'Please select a file to upload.');
        res.redirect(`/projects/${projectId}`);
        return;
      }

      const uploadResult = await storageService.uploadTenantFile(tenantId, req.file, `projects/${projectId}`);
      const documentName = req.body.documentName?.trim() || req.file.originalname;

      await query(`
        INSERT INTO project_documents (
          id, tenant_id, project_id, name, file_url, file_size, file_type, uploaded_by_id, created_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, NOW()
        )
      `, [
        tenantId,
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
   * Delete project document
   */
  deleteDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const projectId = req.params.id as string;
      const docId = req.params.docId as string;

      const docRes = await query(`
        SELECT * FROM project_documents WHERE id = $1 AND project_id = $2 AND tenant_id = $3
      `, [docId, projectId, tenantId]);

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
