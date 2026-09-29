// ══════════════════════════════════════════════════════════════════════
// Project Controller - Raw PostgreSQL Queries
// Project lifecycle, tasks, and team assignments
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database';
import { ProjectModel, TaskModel, ProjectStatus, TaskPriority, TaskStatus, AuditAction } from '../models';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import storageService from '../services/storage.service';
import ActionLogService from '../services/actionLog.service';
import { formatKES } from '../utils/taxCalculator';
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

      const [projectRes, tasksRes, membersRes, usersRes, docsRes] = await Promise.all([
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
        query(`
          SELECT pd.*, u.first_name, u.last_name
          FROM project_documents pd
          LEFT JOIN users u ON pd.uploaded_by_id = u.id
          WHERE pd.project_id = $1 AND pd.tenant_id = $2
          ORDER BY pd.created_at DESC
        `, [projectId, tenantId]),
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
        documents: docsRes.rows,
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
}

export default new ProjectController();
