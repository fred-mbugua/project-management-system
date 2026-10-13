// ══════════════════════════════════════════════════════════════════════
// Team Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { UserModel } from '../models/user.model';
import { SubscriptionModel } from '../models/subscription.model';
import { UserRole, ProjectScope, UserModulePermissions, AuditAction } from '../models/types';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { formatKES } from '../utils/taxCalculator';
import { DEFAULT_ROLE_PERMISSIONS, resolveUserPermissions } from '../middleware/rbac';
import { ActionLogService } from '../services/actionLog.service';
import logger from '../utils/logger';

const teamLogger = logger.child('TeamController');

export const MODULE_LIST: Array<{ key: keyof UserModulePermissions; label: string; description: string }> = [
  { key: 'projects', label: 'Projects & Tasks', description: 'Projects, tasks, team assignment, Gantt & Kanban' },
  { key: 'calendar', label: 'Calendar & Schedule', description: 'Project deadlines, tasks, and company calendar' },
  { key: 'maintenance', label: 'Maintenance & AMC', description: 'Annual contracts, recurring billing, visit schedules' },
  { key: 'quotations', label: 'Quotations & Estimates', description: 'Generate, convert to invoice, PDF export' },
  { key: 'invoices', label: 'Invoices & Payments', description: 'Billing, PDF downloads, M-Pesa & manual payments' },
  { key: 'expenses', label: 'Expenses & Petty Cash', description: 'Expense tracking, receipts, project cost allocation' },
  { key: 'accounting', label: 'Accounting & Reports', description: 'Income statements, balance sheets, profit & loss' },
  { key: 'team', label: 'Team & Permissions', description: 'Team directory, rates, and user access management' },
  { key: 'clients', label: 'Client Directory', description: 'Client CRM, contacts, portal accounts' },
  { key: 'settings', label: 'Company Settings', description: 'Branding, M-Pesa, bank accounts, and configurations' },
  { key: 'audit_logs', label: 'Audit Trail & Logs', description: 'Security audit logs and system activity tracking' },
];

export class TeamController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === UserRole.SUPER_ADMIN;

      const params = extractPaginationParams(req, 10);
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (tenantId && !isSuper) {
        conditions.push(`u.tenant_id = $${paramIdx++}`);
        values.push(tenantId);
      }

      if (params.search) {
        conditions.push(`(
          u.first_name ILIKE $${paramIdx} OR
          u.last_name ILIKE $${paramIdx} OR
          u.email ILIKE $${paramIdx} OR
          u.phone ILIKE $${paramIdx} OR
          u.role ILIKE $${paramIdx}
        )`);
        values.push(`%${params.search}%`);
        paramIdx++;
      }

      if (params.startDate) {
        conditions.push(`u.created_at >= $${paramIdx++}::timestamptz`);
        values.push(`${params.startDate}T00:00:00Z`);
      }

      if (params.endDate) {
        conditions.push(`u.created_at <= $${paramIdx++}::timestamptz`);
        values.push(`${params.endDate}T23:59:59Z`);
      }

      if (req.query.role) {
        conditions.push(`u.role = $${paramIdx++}`);
        values.push(req.query.role);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countSql = `SELECT COUNT(*)::int as total FROM users u ${whereClause}`;
      const countRes = await query(countSql, values);
      const total = countRes.rows[0]?.total || 0;

      const dataSql = `
        SELECT u.*, t.name as tenant_name 
        FROM users u 
        LEFT JOIN tenants t ON u.tenant_id = t.id 
        ${whereClause}
        ORDER BY u.created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `;
      const dataValues = [...values, params.limit, params.offset];
      const members = await query(dataSql, dataValues);

      // Recent payouts if any
      const payoutsRes = await query(`
        SELECT tp.*, u.first_name, u.last_name, u.mpesa_number
        FROM team_payouts tp
        JOIN users u ON tp.user_id = u.id
        WHERE tp.tenant_id = $1
        ORDER BY tp.payout_date DESC
        LIMIT 10
      `, [tenantId || 'none']);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/team/index', {
        title: 'Team Directory',
        members: members.rows,
        payouts: payoutsRes.rows,
        pagination,
        filters: { ...params, role: req.query.role },
        formatKES,
      });
    } catch (error) {
      teamLogger.error('Failed to list team members', { error: String(error) });
      next(error);
    }
  };

  showNew = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (tenantId) {
        const limitCheck = await SubscriptionModel.checkTenantResourceLimit(tenantId, 'users');
        if (!limitCheck.allowed) {
          req.flash('error', limitCheck.message || 'Team member limit reached for your subscription package.');
          res.redirect('/team');
          return;
        }
      }

      res.render('pages/team/new', {
        title: 'Invite Team Member',
        roles: [
          UserRole.PROJECT_MANAGER,
          UserRole.ACCOUNTANT,
          UserRole.TEAM_MEMBER,
          UserRole.CLIENT_PORTAL,
        ],
        defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS,
        modules: MODULE_LIST,
      });
    } catch (error) {
      next(error);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      // Enforce subscription user limit
      const limitCheck = await SubscriptionModel.checkTenantResourceLimit(tenantId, 'users');
      if (!limitCheck.allowed) {
        req.flash('error', limitCheck.message || 'Team member limit reached for your subscription package.');
        res.redirect('/team/new');
        return;
      }

      const {
        firstName,
        lastName,
        email,
        phone,
        role,
        hourlyRate,
        mpesaNumber,
        password,
        projectScope,
        permissions: inputPermissions,
      } = req.body;

      if (!firstName || !lastName || !email || !password) {
        req.flash('error', 'First name, last name, email, and temporary password are required.');
        res.redirect('/team/new');
        return;
      }

      // Check if email already taken
      const existing = await UserModel.findByEmail(email);
      if (existing) {
        req.flash('error', `A user with email ${email} already exists.`);
        res.redirect('/team/new');
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const chosenRole = (role as UserRole) || UserRole.TEAM_MEMBER;
      const assignedScope: ProjectScope = projectScope === 'ASSIGNED' ? 'ASSIGNED' : 'ALL';

      let fullPermissions: UserModulePermissions | undefined = undefined;
      if (inputPermissions && typeof inputPermissions === 'object') {
        const partialPerms: Partial<UserModulePermissions> = {
          projects: ['none', 'view', 'manage'].includes(inputPermissions.projects) ? inputPermissions.projects : undefined,
          calendar: ['none', 'view', 'manage'].includes(inputPermissions.calendar) ? inputPermissions.calendar : undefined,
          maintenance: ['none', 'view', 'manage'].includes(inputPermissions.maintenance) ? inputPermissions.maintenance : undefined,
          quotations: ['none', 'view', 'manage'].includes(inputPermissions.quotations) ? inputPermissions.quotations : undefined,
          invoices: ['none', 'view', 'manage'].includes(inputPermissions.invoices) ? inputPermissions.invoices : undefined,
          expenses: ['none', 'view', 'manage'].includes(inputPermissions.expenses) ? inputPermissions.expenses : undefined,
          accounting: ['none', 'view', 'manage'].includes(inputPermissions.accounting) ? inputPermissions.accounting : undefined,
          team: ['none', 'view', 'manage'].includes(inputPermissions.team) ? inputPermissions.team : undefined,
          clients: ['none', 'view', 'manage'].includes(inputPermissions.clients) ? inputPermissions.clients : undefined,
          settings: ['none', 'view', 'manage'].includes(inputPermissions.settings) ? inputPermissions.settings : undefined,
          audit_logs: ['none', 'view', 'manage'].includes(inputPermissions.audit_logs) ? inputPermissions.audit_logs : undefined,
        };
        fullPermissions = resolveUserPermissions(chosenRole, partialPerms);
      }

      const newUser = await UserModel.create({
        tenantId,
        firstName,
        lastName,
        email,
        phone: phone || null,
        role: chosenRole,
        hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
        mpesaNumber: mpesaNumber || null,
        passwordHash,
        projectScope: assignedScope,
        permissions: fullPermissions,
      });

      await ActionLogService.record(req, {
        action: AuditAction.CREATE,
        entityType: 'user',
        entityId: newUser.id,
        description: `Created new team member ${firstName} ${lastName} (${chosenRole}) with scope ${assignedScope}`,
      });

      req.flash('success', `Team member ${firstName} ${lastName} added successfully.`);
      res.redirect('/team');
    } catch (error) {
      teamLogger.error('Failed to create team member', { error: String(error) });
      next(error);
    }
  };

  showEdit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === UserRole.SUPER_ADMIN;

      const targetUser = await UserModel.findById(id);
      if (!targetUser || (!isSuper && targetUser.tenantId !== tenantId)) {
        req.flash('error', 'Team member not found.');
        res.redirect('/team');
        return;
      }

      const resolvedPerms = resolveUserPermissions(targetUser.role, targetUser.permissions);

      res.render('pages/team/edit', {
        title: `Edit ${targetUser.firstName} ${targetUser.lastName}`,
        targetUser,
        permissions: resolvedPerms,
        roles: [
          UserRole.TENANT_OWNER,
          UserRole.PROJECT_MANAGER,
          UserRole.ACCOUNTANT,
          UserRole.TEAM_MEMBER,
          UserRole.CLIENT_PORTAL,
        ],
        defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS,
        modules: MODULE_LIST,
      });
    } catch (error) {
      teamLogger.error('Failed to load edit team member page', { error: String(error) });
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === UserRole.SUPER_ADMIN;

      const existingUser = await UserModel.findById(id);
      if (!existingUser || (!isSuper && existingUser.tenantId !== tenantId)) {
        req.flash('error', 'Team member not found.');
        res.redirect('/team');
        return;
      }

      const {
        firstName,
        lastName,
        phone,
        role,
        hourlyRate,
        mpesaNumber,
        projectScope,
        isActive,
        permissions: inputPermissions,
      } = req.body;

      if (!firstName || !lastName) {
        req.flash('error', 'First name and last name are required.');
        res.redirect(`/team/${id}/edit`);
        return;
      }

      let customPermissions: UserModulePermissions | undefined = undefined;
      if (inputPermissions && typeof inputPermissions === 'object') {
        const partialPerms: Partial<UserModulePermissions> = {
          projects: ['none', 'view', 'manage'].includes(inputPermissions.projects) ? inputPermissions.projects : 'none',
          calendar: ['none', 'view', 'manage'].includes(inputPermissions.calendar) ? inputPermissions.calendar : 'none',
          maintenance: ['none', 'view', 'manage'].includes(inputPermissions.maintenance) ? inputPermissions.maintenance : 'none',
          quotations: ['none', 'view', 'manage'].includes(inputPermissions.quotations) ? inputPermissions.quotations : 'none',
          invoices: ['none', 'view', 'manage'].includes(inputPermissions.invoices) ? inputPermissions.invoices : 'none',
          expenses: ['none', 'view', 'manage'].includes(inputPermissions.expenses) ? inputPermissions.expenses : 'none',
          accounting: ['none', 'view', 'manage'].includes(inputPermissions.accounting) ? inputPermissions.accounting : 'none',
          team: ['none', 'view', 'manage'].includes(inputPermissions.team) ? inputPermissions.team : 'none',
          clients: ['none', 'view', 'manage'].includes(inputPermissions.clients) ? inputPermissions.clients : 'none',
          settings: ['none', 'view', 'manage'].includes(inputPermissions.settings) ? inputPermissions.settings : 'none',
          audit_logs: ['none', 'view', 'manage'].includes(inputPermissions.audit_logs) ? inputPermissions.audit_logs : 'none',
        };
        customPermissions = resolveUserPermissions((role as UserRole) || existingUser.role, partialPerms);
      }

      const assignedScope: ProjectScope = projectScope === 'ASSIGNED' ? 'ASSIGNED' : 'ALL';
      const activeState = isActive !== undefined ? (isActive === 'true' || isActive === true || isActive === '1' || isActive === 'on') : existingUser.isActive;

      await UserModel.updateTeamMember(id, {
        firstName,
        lastName,
        phone: phone || null,
        role: (role as UserRole) || existingUser.role,
        projectScope: assignedScope,
        permissions: customPermissions,
        hourlyRate: hourlyRate !== '' && hourlyRate != null ? parseFloat(hourlyRate) : null,
        mpesaNumber: mpesaNumber || null,
        isActive: activeState,
      });

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'user_permissions',
        entityId: id,
        description: `Updated profile, project scope (${assignedScope}), and permissions for ${firstName} ${lastName}`,
      });

      req.flash('success', `Team member ${firstName} ${lastName} updated successfully.`);
      res.redirect('/team');
    } catch (error) {
      teamLogger.error('Failed to update team member', { error: String(error) });
      next(error);
    }
  };

  toggleStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = String(req.params.id);
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === UserRole.SUPER_ADMIN;

      if (id === req.user?.id) {
        req.flash('error', 'You cannot deactivate your own account.');
        res.redirect('/team');
        return;
      }

      const existingUser = await UserModel.findById(id);
      if (!existingUser || (!isSuper && existingUser.tenantId !== tenantId)) {
        req.flash('error', 'Team member not found.');
        res.redirect('/team');
        return;
      }

      const newStatus = await UserModel.toggleActive(id);

      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'user_status',
        entityId: id,
        description: `Toggled status of user ${existingUser.firstName} ${existingUser.lastName} to ${newStatus ? 'Active' : 'Inactive'}`,
      });

      req.flash('success', `Team member ${existingUser.firstName} is now ${newStatus ? 'active' : 'inactive'}.`);
      res.redirect('/team');
    } catch (error) {
      teamLogger.error('Failed to toggle team member status', { error: String(error) });
      next(error);
    }
  };
}

export default new TeamController();
