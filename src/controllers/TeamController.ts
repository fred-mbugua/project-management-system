// ══════════════════════════════════════════════════════════════════════
// Team Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { UserModel } from '../models/user.model';
import { UserRole } from '../models/types';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const teamLogger = logger.child('TeamController');

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

  showNew = async (_req: Request, res: Response): Promise<void> => {
    res.render('pages/team/new', {
      title: 'Invite Team Member',
      roles: [
        UserRole.PROJECT_MANAGER,
        UserRole.ACCOUNTANT,
        UserRole.TEAM_MEMBER,
        UserRole.CLIENT_PORTAL,
      ],
    });
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const { firstName, lastName, email, phone, role, hourlyRate, mpesaNumber, password } = req.body;

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

      await UserModel.create({
        tenantId,
        firstName,
        lastName,
        email,
        phone: phone || null,
        role: role as UserRole || UserRole.TEAM_MEMBER,
        hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
        mpesaNumber: mpesaNumber || null,
        passwordHash,
      });

      req.flash('success', `Team member ${firstName} ${lastName} added successfully.`);
      res.redirect('/team');
    } catch (error) {
      teamLogger.error('Failed to create team member', { error: String(error) });
      next(error);
    }
  };
}

export default new TeamController();
