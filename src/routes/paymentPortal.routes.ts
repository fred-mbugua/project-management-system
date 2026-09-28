import { Router } from 'express';
import paymentPortalController from '../controllers/PaymentPortalController';

const router = Router();

// Public Payment Portal routes (No session/login required)
router.get('/:token', paymentPortalController.showPortal);
router.post('/:token/mpesa-stk', paymentPortalController.initiateMpesaStk);
router.get('/:token/status', paymentPortalController.checkStatus);
router.post('/:token/confirm', paymentPortalController.confirmPayment);
router.get('/:token/receipt', paymentPortalController.downloadReceipt);

export default router;
