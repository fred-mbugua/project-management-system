// ══════════════════════════════════════════════════════════════════════
// Profile Controller
// Allows logged-in users to view and update their profile and password
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserModel, AuditAction } from '../models';
import ActionLogService from '../services/actionLog.service';
import logger from '../utils/logger';

const profileLogger = logger.child('ProfileController');

// Input validation schemas
const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  phone: z.string().trim().max(50).optional().nullable(),
  mpesaNumber: z.string().trim().max(50).optional().nullable(),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'New passwords do not match',
    path: ['confirmPassword'],
  });

export class ProfileController {
  /**
   * View logged-in user profile
   */
  showProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        req.flash('error', 'Please log in to view your profile.');
        res.redirect('/auth/login');
        return;
      }

      const user = await UserModel.findByIdWithTenant(userId);
      if (!user) {
        req.flash('error', 'User profile not found.');
        res.redirect('/dashboard');
        return;
      }

      res.render('pages/profile/index', {
        title: 'My Profile',
        user,
      });
    } catch (error) {
      profileLogger.error('Error fetching user profile', { error: String(error) });
      next(error);
    }
  };

  /**
   * Update personal and contact details
   */
  updateContact = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        req.flash('error', 'Session expired. Please log in.');
        res.redirect('/auth/login');
        return;
      }

      const parseResult = updateProfileSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorMsg = parseResult.error.issues[0]?.message || 'Invalid input provided.';
        req.flash('error', errorMsg);
        res.redirect('/profile');
        return;
      }

      const { firstName, lastName, phone, mpesaNumber } = parseResult.data;

      const updatedUser = await UserModel.updateProfile(userId, {
        firstName,
        lastName,
        phone: phone || null,
        mpesaNumber: mpesaNumber || null,
      });

      // Update in-flight session and request objects
      if (req.user) {
        req.user.firstName = updatedUser.firstName;
        req.user.lastName = updatedUser.lastName;
        req.user.phone = updatedUser.phone ?? null;
      }

      // Record in audit log
      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'USER',
        entityId: userId,
        description: `User ${updatedUser.email} updated contact information`,
        metadata: { firstName, lastName, phone, mpesaNumber },
      });

      profileLogger.info('User profile contact updated', { userId });
      req.flash('success', 'Your contact information has been successfully updated.');
      res.redirect('/profile');
    } catch (error) {
      profileLogger.error('Failed to update contact details', { error: String(error) });
      req.flash('error', 'Failed to update profile information. Please try again.');
      res.redirect('/profile');
    }
  };

  /**
   * Change user password
   */
  updatePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        req.flash('error', 'Session expired. Please log in.');
        res.redirect('/auth/login');
        return;
      }

      const parseResult = changePasswordSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorMsg = parseResult.error.issues[0]?.message || 'Invalid password submission.';
        req.flash('error', errorMsg);
        res.redirect('/profile');
        return;
      }

      const { currentPassword, newPassword } = parseResult.data;

      const user = await UserModel.findById(userId);
      if (!user) {
        req.flash('error', 'User account not found.');
        res.redirect('/auth/login');
        return;
      }

      // Verify current password against stored bcrypt hash
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        req.flash('error', 'The current password you entered is incorrect.');
        res.redirect('/profile');
        return;
      }

      // Hash new password using 12 salt rounds
      const newHash = await bcrypt.hash(newPassword, 12);
      await UserModel.updatePassword(userId, newHash);

      // Record in audit log
      await ActionLogService.record(req, {
        action: AuditAction.UPDATE,
        entityType: 'USER',
        entityId: userId,
        description: `User ${user.email} successfully changed their account password`,
      });

      profileLogger.info('User password successfully changed', { userId });
      req.flash('success', 'Your password has been changed successfully.');
      res.redirect('/profile');
    } catch (error) {
      profileLogger.error('Failed to change password', { error: String(error) });
      req.flash('error', 'An error occurred while changing your password. Please try again.');
      res.redirect('/profile');
    }
  };
}

export default new ProfileController();
