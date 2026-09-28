import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import settingsController from '../controllers/SettingsController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '../models/types';
import { uploadLogo } from '../middleware/upload';

const router = Router();

router.use(requireAuth, resolveTenant, requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER));

router.get('/', settingsController.index);

// Safe Multer upload middleware with flash error reporting
const handleLogoUpload = (req: Request, res: Response, next: NextFunction) => {
  uploadLogo.single('logo')(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          req.flash('error', 'Uploaded logo exceeds the 5MB size limit. Please choose a smaller image.');
          return res.redirect('/settings');
        }
        req.flash('error', `Upload error: ${err.message}`);
        return res.redirect('/settings');
      }
      req.flash('error', err.message || 'Failed to upload logo.');
      return res.redirect('/settings');
    }
    if (!req.body) {
      req.body = {};
    }
    next();
  });
};

router.post('/', handleLogoUpload, settingsController.update);
router.post('/test-payment', settingsController.testPaymentConfig);

export default router;
