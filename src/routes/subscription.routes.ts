// ══════════════════════════════════════════════════════════════════════
// Subscription & Billing Routes
// ══════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import subscriptionController from '../controllers/SubscriptionController';
import { requireAuth } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenant';
import { requireRole } from '../middleware/rbac';
import { UserRole } from '../models/types';

const router = Router();

// Apply authentication and tenant resolution to all subscription routes
router.use(requireAuth, resolveTenant);

// Tenant Subscription Management Dashboard
router.get(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER),
  subscriptionController.index
);

// Subscription Renewal Payment Page (Accessible even when subscription is expired)
router.get('/pay', subscriptionController.showPayPage);
router.get('/renew', subscriptionController.showPayPage);

// Payment Initiation & Verification
router.post('/mpesa-stk', subscriptionController.initiateMpesaStk);
router.post('/paypal/create-order', subscriptionController.createPaypalOrder);
router.post('/paypal/capture-order', subscriptionController.capturePaypalOrder);
router.post('/verify-payment', subscriptionController.verifyPayment);
router.get('/status/:invoiceId', subscriptionController.checkInvoiceStatus);

// Change / Upgrade Plan
router.post(
  '/change-plan',
  requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER),
  subscriptionController.changePlan
);

// Cancel Subscription
router.post(
  '/cancel',
  requireRole(UserRole.SUPER_ADMIN, UserRole.TENANT_OWNER),
  subscriptionController.cancelSubscription
);

export default router;
