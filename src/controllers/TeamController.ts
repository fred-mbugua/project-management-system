// ══════════════════════════════════════════════════════════════════════
// Team Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { UserModel } from '../models/user.model';
import { UserRole } from '../models/types';
import { formatKES } from '../utils/taxCalculator';
import logger from '../utils/logger';

const teamLogger = logger.child('TeamController');

export class TeamController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const isSuper = req.user?.role === UserRole.SUPER_ADMIN;

      let members;
      if (isSuper && !tenantId) {
        members = await query(`
          SELECT u.*, t.name as tenant_name 
          FROM users u 
          LEFT JOIN tenants t ON u.tenant_id = t.id 
          ORDER BY u.created_at DESC
        `);
      } else {
        members = await query(`
          SELECT * FROM users 
          WHERE tenant_id = $1 
          ORDER BY first_name ASC, last_name ASC
        `, [tenantId]);
      }

      // Recent payouts if any
      const payoutsRes = await query(`
        SELECT tp.*, u.first_name, u.last_name, u.mpesa_number
        FROM team_payouts tp
        JOIN users u ON tp.user_id = u.id
        WHERE tp.tenant_id = $1
        ORDER BY tp.payout_date DESC
        LIMIT 10
      `, [tenantId || 'none']);

      res.render('pages/team/index', {
        title: 'Team Directory',
        members: members.rows,
        payouts: payoutsRes.rows,
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
