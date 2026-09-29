// ══════════════════════════════════════════════════════════════════════
// Subscription Controller - Tenant Subscription Management & Renewals
// Multi-tenant isolation, automated activations, and email notifications
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { query, withTransaction } from '../config/database';
import { TenantModel } from '../models/tenant.model';
import { SubscriptionModel } from '../models/subscription.model';
import PlatformPaymentSettingsModel from '../models/platformSettings.model';
import emailService from '../services/email.service';
import ActionLogService from '../services/actionLog.service';
import { AuditAction } from '../models/types';
import appConfig from '../config/app';
import logger from '../utils/logger';
import { formatKES } from '../utils/taxCalculator';
import storageService from '../services/storage.service';

const subLogger = logger.child('SubscriptionController');

export class SubscriptionController {
  /**
   * Main Subscription & Billing Management Page for Tenant
   */
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        req.flash('error', 'Organization context required.');
        res.redirect('/auth/login');
        return;
      }

      const tenant = await TenantModel.findById(tenantId);
      if (!tenant) {
        req.flash('error', 'Organization not found.');
        res.redirect('/auth/login');
        return;
      }

      // 1. Fetch current subscription details
      const subRes = await query(
        `
        SELECT 
          ts.id as subscription_id,
          ts.tenant_id,
          ts.plan_id,
          ts.status as subscription_status,
          ts.billing_cycle,
          ts.current_period_start,
          ts.current_period_end,
          ts.auto_renew,
          ts.mpesa_receipt_no,
          sp.id as plan_id,
          sp.name as plan_name,
          sp.tier as plan_tier,
          COALESCE(sp.price, sp.monthly_price, 0)::numeric as plan_price,
          sp.frequency as plan_frequency,
          sp.interval_months,
          sp.max_users,
          sp.max_projects,
          sp.max_storage_mb,
          sp.features
        FROM tenant_subscriptions ts
        JOIN subscription_plans sp ON ts.plan_id = sp.id
        WHERE ts.tenant_id = $1
        LIMIT 1
        `,
        [tenantId]
      );

      const subscription = subRes.rows[0] || null;

      // Calculate days remaining
      let daysRemaining = 0;
      let isExpired = false;
      let isExpiringSoon = false;

      if (subscription && subscription.current_period_end) {
        const expiryDate = new Date(subscription.current_period_end);
        const diffMs = expiryDate.getTime() - Date.now();
        daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (daysRemaining <= 0 || subscription.subscription_status === 'EXPIRED') {
          isExpired = true;
          daysRemaining = 0;
        } else if (daysRemaining <= 3) {
          isExpiringSoon = true;
        }
      }

      // 2. Fetch available active plans for upgrade/switch
      const plansRes = await query(
        `SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY monthly_price ASC`
      );
      const availablePlans = plansRes.rows.map((p) => ({
        id: p.id,
        name: p.name,
        tier: p.tier,
        price: parseFloat(p.price || p.monthly_price || 0),
        frequency: p.frequency || 'MONTHLY',
        intervalMonths: p.interval_months || 1,
        maxUsers: p.max_users,
        maxProjects: p.max_projects,
        maxStorageMb: p.max_storage_mb,
        features: typeof p.features === 'string' ? JSON.parse(p.features) : p.features || {},
        description: p.description,
      }));

      // 3. Fetch resource usage metrics
      const [usersCountRes, projectsCountRes, storageCountRes] = await Promise.all([
        query(`SELECT COUNT(*)::int as count FROM users WHERE tenant_id = $1 AND is_active = TRUE`, [tenantId]),
        query(`SELECT COUNT(*)::int as count FROM projects WHERE tenant_id = $1 AND status != 'CANCELLED'`, [tenantId]),
        query(
          `SELECT COALESCE(SUM(file_size), 0)::bigint as total_bytes 
           FROM project_documents pd 
           JOIN projects p ON pd.project_id = p.id 
           WHERE p.tenant_id = $1`,
          [tenantId]
        ),
      ]);

      const usersCount = usersCountRes.rows[0]?.count || 0;
      const projectsCount = projectsCountRes.rows[0]?.count || 0;
      const storageBytes = parseInt(storageCountRes.rows[0]?.total_bytes || '0', 10);
      const storageMb = Math.round(storageBytes / (1024 * 1024));

      // 4. Fetch subscription billing invoices
      const invoicesRes = await query(
        `
        SELECT 
          si.*,
          sp.name as plan_name
        FROM subscription_invoices si
        LEFT JOIN subscription_plans sp ON si.plan_id = sp.id
        WHERE si.tenant_id = $1
        ORDER BY si.created_at DESC
        `,
        [tenantId]
      );

      const invoices = invoicesRes.rows;

      // Real-time comprehensive storage usage metrics
      const storageMetrics = await storageService.getTenantStorageUsage(tenantId);
      const isCancelled = Boolean(
        subscription && (subscription.subscription_status === 'CANCELLED' || subscription.subscription_status === 'CANCELED')
      );

      res.render('pages/subscription/index', {
        title: 'Subscription & Billing',
        tenant,
        subscription,
        daysRemaining,
        isExpired,
        isExpiringSoon,
        isCancelled,
        subscriptionExempt: Boolean(tenant.subscriptionExempt),
        storageMetrics,
        availablePlans,
        usage: {
          usersCount,
          projectsCount,
          storageMb: storageMetrics.usedMb,
        },
        invoices,
        formatKES,
      });
    } catch (error) {
      subLogger.error('Failed to load tenant subscription dashboard', { error: String(error) });
      next(error);
    }
  };

  /**
   * Payment Page for Subscription Renewal / Plan Activation
   */
  showPayPage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        req.flash('error', 'Organization context required.');
        res.redirect('/auth/login');
        return;
      }

      const tenant = await TenantModel.findById(tenantId);
      if (!tenant) {
        req.flash('error', 'Organization not found.');
        res.redirect('/auth/login');
        return;
      }

      // Check if user requested a specific plan upgrade/switch
      const requestedPlanId = req.query.planId as string;
      let targetPlan: any = null;

      if (requestedPlanId) {
        targetPlan = await SubscriptionModel.findPlanById(requestedPlanId);
      }

      // 1. Check for an existing UNPAID subscription invoice
      let invoiceRes = await query(
        `
        SELECT 
          si.*,
          sp.name as plan_name,
          sp.tier as plan_tier,
          COALESCE(sp.interval_months, 1)::int as interval_months
        FROM subscription_invoices si
        LEFT JOIN subscription_plans sp ON si.plan_id = sp.id
        WHERE si.tenant_id = $1 AND si.status = 'UNPAID'
        ORDER BY si.created_at DESC
        LIMIT 1
        `,
        [tenantId]
      );

      let invoice = invoiceRes.rows[0];

      // If user requested a different plan than the existing unpaid invoice, update the invoice
      if (invoice && targetPlan && invoice.plan_id !== targetPlan.id) {
        const newAmount = targetPlan.price || targetPlan.monthlyPrice;
        await query(
          `UPDATE subscription_invoices 
           SET plan_id = $1, amount = $2, total_amount = $2, updated_at = NOW() 
           WHERE id = $3`,
          [targetPlan.id, newAmount, invoice.id]
        );
        invoice.plan_id = targetPlan.id;
        invoice.amount = newAmount;
        invoice.total_amount = newAmount;
        invoice.plan_name = targetPlan.name;
        invoice.plan_tier = targetPlan.tier;
      }

      // 2. If no unpaid invoice exists, create one now for renewal
      if (!invoice) {
        // Fetch current subscription plan or targetPlan or starter plan
        let planId = targetPlan?.id;
        let planName = targetPlan?.name;
        let amount = targetPlan ? (targetPlan.price || targetPlan.monthlyPrice) : 0;
        let intervalMonths = targetPlan?.intervalMonths || 1;

        if (!planId) {
          const currentSubRes = await query(
            `SELECT ts.plan_id, ts.current_period_end, sp.name as plan_name, COALESCE(sp.price, sp.monthly_price, 0)::numeric as plan_price, sp.interval_months
             FROM tenant_subscriptions ts
             JOIN subscription_plans sp ON ts.plan_id = sp.id
             WHERE ts.tenant_id = $1 LIMIT 1`,
            [tenantId]
          );

          if (currentSubRes.rows.length > 0) {
            const currentSub = currentSubRes.rows[0];
            planId = currentSub.plan_id;
            planName = currentSub.plan_name;
            amount = parseFloat(currentSub.plan_price || 0);
            intervalMonths = currentSub.interval_months || 1;
          } else {
            // Default to Starter plan
            const defaultPlan = await query(`SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY monthly_price ASC LIMIT 1`);
            if (defaultPlan.rows.length > 0) {
              const def = defaultPlan.rows[0];
              planId = def.id;
              planName = def.name;
              amount = parseFloat(def.price || def.monthly_price || 0);
              intervalMonths = def.interval_months || 1;
            }
          }
        }

        const year = new Date().getFullYear();
        const rand = Math.floor(100000 + Math.random() * 900000);
        const invoiceNumber = `SUB-INV-${year}-${rand}`;

        const periodStart = new Date();
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7);

        const newInvoiceRes = await query(
          `
          INSERT INTO subscription_invoices (
            id, tenant_id, plan_id, invoice_number,
            amount, tax_amount, total_amount, status,
            billing_period_start, billing_period_end, due_date,
            updated_at
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3,
            $4, 0, $4, 'UNPAID',
            $5, $6, $7,
            NOW()
          )
          RETURNING *
          `,
          [tenantId, planId, invoiceNumber, amount, periodStart, periodEnd, dueDate]
        );

        invoice = {
          ...newInvoiceRes.rows[0],
          plan_name: planName,
          interval_months: intervalMonths,
        };
      }

      // 3. Load platform payment settings (configured by SUPER_ADMIN)
      const paymentSettings = await PlatformPaymentSettingsModel.getSettings();

      // 4. Retrieve tenant owner phone number for prefilling M-Pesa input
      const ownerRes = await query(
        `SELECT phone, email FROM users WHERE tenant_id = $1 AND role = 'TENANT_OWNER' LIMIT 1`,
        [tenantId]
      );
      const ownerPhone = ownerRes.rows[0]?.phone || tenant.phone || '';

      res.render('pages/subscription/pay', {
        title: 'Renew Workspace Subscription',
        tenant,
        invoice,
        paymentSettings,
        ownerPhone,
        formatKES,
        appConfig,
      });
    } catch (error) {
      subLogger.error('Failed to render subscription pay page', { error: String(error) });
      next(error);
    }
  };

  /**
   * Initiate Daraja M-Pesa STK Push for Subscription Invoice Payment
   */
  initiateMpesaStk = async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const { invoiceId, phoneNumber } = req.body;
      if (!invoiceId) {
        res.status(400).json({ success: false, message: 'Invoice ID is required' });
        return;
      }

      if (!phoneNumber || typeof phoneNumber !== 'string') {
        res.status(400).json({ success: false, message: 'Valid Safaricom phone number is required' });
        return;
      }

      // Sanitize phone number (e.g. 0712345678 -> 254712345678)
      let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '254' + cleanPhone.substring(1);
      } else if (cleanPhone.startsWith('+254')) {
        cleanPhone = cleanPhone.substring(1);
      } else if (!cleanPhone.startsWith('254') && cleanPhone.length === 9) {
        cleanPhone = '254' + cleanPhone;
      }

      if (cleanPhone.length !== 12 || !cleanPhone.startsWith('254')) {
        res.status(400).json({ success: false, message: 'Invalid Kenyan phone number format. Use 07XXXXXXXX or 2547XXXXXXXX' });
        return;
      }

      // Verify invoice exists and belongs to this tenant
      const invoiceRes = await query(
        `SELECT * FROM subscription_invoices WHERE id = $1 AND tenant_id = $2 AND status = 'UNPAID'`,
        [invoiceId, tenantId]
      );

      if (invoiceRes.rows.length === 0) {
        res.status(404).json({ success: false, message: 'Unpaid invoice not found' });
        return;
      }

      const invoice = invoiceRes.rows[0];
      const amount = Math.round(parseFloat(invoice.total_amount));

      // Fetch platform payment settings
      const settings = await PlatformPaymentSettingsModel.getSettings();
      if (!settings.mpesaEnabled) {
        res.status(400).json({ success: false, message: 'M-Pesa payment is currently disabled by administrator.' });
        return;
      }

      const {
        mpesaShortcode,
        mpesaPasskey,
        mpesaConsumerKey,
        mpesaConsumerSecret,
        mpesaEnvironment,
      } = settings;

      // Handle Sandbox / Live Daraja STK Push
      const hasLiveCredentials = Boolean(
        mpesaConsumerKey &&
        mpesaConsumerSecret &&
        mpesaPasskey &&
        !mpesaConsumerKey.includes('your_')
      );

      let checkoutRequestId = `WS_SUB_${Date.now()}`;

      if (hasLiveCredentials) {
        try {
          const authUrl = mpesaEnvironment === 'production'
            ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
            : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

          const authHeader = Buffer.from(`${mpesaConsumerKey}:${mpesaConsumerSecret}`).toString('base64');
          const tokenRes = await axios.get(authUrl, {
            headers: { Authorization: `Basic ${authHeader}` },
            timeout: 10000,
          });

          const accessToken = tokenRes.data.access_token;
          const timestamp = new Date()
            .toISOString()
            .replace(/[^0-9]/g, '')
            .slice(0, 14);

          const password = Buffer.from(`${mpesaShortcode}${mpesaPasskey}${timestamp}`).toString('base64');

          const stkUrl = mpesaEnvironment === 'production'
            ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
            : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

          const callbackUrl = `${appConfig.appUrl}/subscription/mpesa-callback`;

          const stkRes = await axios.post(
            stkUrl,
            {
              BusinessShortCode: mpesaShortcode,
              Password: password,
              Timestamp: timestamp,
              TransactionType: settings.mpesaShortcodeType === 'TILL' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
              Amount: amount > 0 ? amount : 1,
              PartyA: cleanPhone,
              PartyB: mpesaShortcode,
              PhoneNumber: cleanPhone,
              CallBackURL: callbackUrl,
              AccountReference: invoice.invoice_number,
              TransactionDesc: `Subscription ${invoice.invoice_number}`,
            },
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              timeout: 15000,
            }
          );

          if (stkRes.data && stkRes.data.CheckoutRequestID) {
            checkoutRequestId = stkRes.data.CheckoutRequestID;
          }
        } catch (apiErr: any) {
          subLogger.warn('Daraja API dispatch failed or in simulation fallback', {
            error: apiErr.response?.data || apiErr.message,
          });
        }
      }

      // Save checkout request ID & phone number to invoice
      await query(
        `UPDATE subscription_invoices 
         SET mpesa_checkout_request_id = $1, mpesa_phone_number = $2, updated_at = NOW() 
         WHERE id = $3`,
        [checkoutRequestId, cleanPhone, invoiceId]
      );

      res.json({
        success: true,
        checkoutRequestId,
        phoneNumber: cleanPhone,
        invoiceNumber: invoice.invoice_number,
        amount,
        isSandbox: mpesaEnvironment === 'sandbox' || !hasLiveCredentials,
        message: `M-Pesa STK push initiated to ${cleanPhone}. Please check your phone and enter your M-Pesa PIN.`,
      });
    } catch (error: any) {
      subLogger.error('Failed to initiate M-Pesa STK push', { error: error.message });
      res.status(500).json({ success: false, message: 'Failed to initiate M-Pesa prompt. Please try again.' });
    }
  };

  /**
   * Create PayPal Order for subscription invoice
   */
  createPaypalOrder = async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const { invoiceId } = req.body;
      if (!invoiceId) {
        res.status(400).json({ success: false, message: 'Invoice ID is required' });
        return;
      }

      const invoiceRes = await query(
        `SELECT si.*, sp.name as plan_name, t.name as tenant_name
         FROM subscription_invoices si
         JOIN tenants t ON si.tenant_id = t.id
         LEFT JOIN subscription_plans sp ON si.plan_id = sp.id
         WHERE si.id = $1 AND si.tenant_id = $2`,
        [invoiceId, tenantId]
      );

      if (invoiceRes.rows.length === 0) {
        res.status(404).json({ success: false, message: 'Invoice not found' });
        return;
      }

      const invoice = invoiceRes.rows[0];
      if (invoice.status === 'PAID') {
        res.json({ success: true, isPaid: true, message: 'Invoice already paid', redirectUrl: '/dashboard' });
        return;
      }

      const settings = await PlatformPaymentSettingsModel.getSettings();
      if (!settings.paypalEnabled) {
        res.status(400).json({ success: false, message: 'PayPal payment is currently disabled by administrator.' });
        return;
      }

      const totalKES = parseFloat(invoice.total_amount);
      const exchangeRate = settings.paypalExchangeRate || 130.00;
      const currency = settings.paypalCurrency || 'USD';
      const amountValue = (totalKES / exchangeRate).toFixed(2);

      const hasApiCredentials = Boolean(
        settings.paypalClientId &&
        settings.paypalClientSecret &&
        !settings.paypalClientId.includes('your_')
      );

      if (hasApiCredentials) {
        const baseUrl = settings.paypalEnvironment === 'production'
          ? 'https://api-m.paypal.com'
          : 'https://api-m.sandbox.paypal.com';

        // 1. Get OAuth2 Token
        const auth = Buffer.from(`${settings.paypalClientId}:${settings.paypalClientSecret}`).toString('base64');
        const tokenRes = await axios.post(
          `${baseUrl}/v1/oauth2/token`,
          'grant_type=client_credentials',
          {
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
          }
        );

        const accessToken = tokenRes.data.access_token;

        // 2. Create Order
        const orderRes = await axios.post(
          `${baseUrl}/v2/checkout/orders`,
          {
            intent: 'CAPTURE',
            purchase_units: [
              {
                reference_id: invoice.invoice_number,
                description: `Subscription: ${invoice.plan_name || 'Standard'} (${invoice.invoice_number})`,
                custom_id: invoice.id,
                amount: {
                  currency_code: currency,
                  value: amountValue,
                },
              },
            ],
            application_context: {
              brand_name: 'Free Style Code Technologies',
              user_action: 'PAY_NOW',
              return_url: `${appConfig.appUrl}/subscription/pay?status=paypal-success`,
              cancel_url: `${appConfig.appUrl}/subscription/pay?status=paypal-cancelled`,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );

        res.json({
          success: true,
          orderId: orderRes.data.id,
          currency,
          amountValue,
          isLive: settings.paypalEnvironment === 'production',
        });
        return;
      }

      // If credentials not yet configured or demo/sandbox fallback
      const simulatedOrderId = `PAYPAL_SIM_${Date.now()}`;
      res.json({
        success: true,
        orderId: simulatedOrderId,
        currency,
        amountValue,
        isSimulated: true,
      });
    } catch (error: any) {
      subLogger.error('Failed to create PayPal order', { error: error.response?.data || error.message });
      res.status(500).json({
        success: false,
        message: error.response?.data?.message || 'Failed to initialize PayPal order.',
      });
    }
  };

  /**
   * Capture PayPal Order & settle subscription
   */
  capturePaypalOrder = async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const { invoiceId, orderId } = req.body;
      if (!invoiceId || !orderId) {
        res.status(400).json({ success: false, message: 'Invoice ID and PayPal Order ID are required' });
        return;
      }

      const settings = await PlatformPaymentSettingsModel.getSettings();
      let transactionCaptureId = orderId;

      const hasApiCredentials = Boolean(
        settings.paypalClientId &&
        settings.paypalClientSecret &&
        !settings.paypalClientId.includes('your_') &&
        !orderId.startsWith('PAYPAL_SIM_')
      );

      if (hasApiCredentials) {
        const baseUrl = settings.paypalEnvironment === 'production'
          ? 'https://api-m.paypal.com'
          : 'https://api-m.sandbox.paypal.com';

        const auth = Buffer.from(`${settings.paypalClientId}:${settings.paypalClientSecret}`).toString('base64');
        const tokenRes = await axios.post(
          `${baseUrl}/v1/oauth2/token`,
          'grant_type=client_credentials',
          {
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
          }
        );

        const accessToken = tokenRes.data.access_token;
        const captureRes = await axios.post(
          `${baseUrl}/v2/checkout/orders/${orderId}/capture`,
          {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );

        const captureData = captureRes.data;
        if (captureData.status !== 'COMPLETED') {
          res.status(400).json({
            success: false,
            message: `PayPal payment not completed (status: ${captureData.status})`,
          });
          return;
        }

        const captureItem = captureData.purchase_units?.[0]?.payments?.captures?.[0];
        if (captureItem?.id) {
          transactionCaptureId = captureItem.id;
        }
      }

      // Settle invoice using verifyPayment logic directly
      req.body = {
        invoiceId,
        paymentMethod: 'PAYPAL',
        transactionRef: transactionCaptureId,
      };

      await this.verifyPayment(req, res);
    } catch (error: any) {
      subLogger.error('Failed to capture PayPal payment', { error: error.response?.data || error.message });
      res.status(500).json({
        success: false,
        message: error.response?.data?.message || 'Failed to capture PayPal payment.',
      });
    }
  };

  /**
   * Verify and Settle Payment (M-Pesa Paybill / STK Simulation / Card / PayPal / Bank)
   * Restores portal access immediately and dispatches payment confirmation email.
   */
  verifyPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
      }

      const { invoiceId, paymentMethod, transactionRef, phoneNumber } = req.body;

      if (!invoiceId) {
        res.status(400).json({ success: false, message: 'Invoice ID is required' });
        return;
      }

      // Validate paymentMethod against allow-list
      const allowedMethods = ['MPESA_STK', 'MPESA_PAYBILL', 'CARD', 'PAYPAL', 'BANK', 'MANUAL'];
      const method = allowedMethods.includes(paymentMethod) ? paymentMethod : 'MPESA_PAYBILL';

      // Validate transactionRef
      const cleanRef = transactionRef && typeof transactionRef === 'string'
        ? transactionRef.trim().toUpperCase()
        : `REC_${Date.now()}`;

      if (!cleanRef || cleanRef.length < 5) {
        res.status(400).json({ success: false, message: 'Valid transaction reference code is required (min 5 characters).' });
        return;
      }

      // Verify invoice
      const invoiceRes = await query(
        `
        SELECT 
          si.*,
          sp.name as plan_name,
          COALESCE(sp.interval_months, 1)::int as interval_months,
          t.name as tenant_name,
          t.email as tenant_email
        FROM subscription_invoices si
        JOIN tenants t ON si.tenant_id = t.id
        LEFT JOIN subscription_plans sp ON si.plan_id = sp.id
        WHERE si.id = $1 AND si.tenant_id = $2
        `,
        [invoiceId, tenantId]
      );

      if (invoiceRes.rows.length === 0) {
        res.status(404).json({ success: false, message: 'Invoice not found or already processed' });
        return;
      }

      const invoice = invoiceRes.rows[0];

      if (invoice.status === 'PAID') {
        res.json({
          success: true,
          message: 'This invoice has already been settled and your workspace is active.',
          redirectUrl: '/dashboard',
        });
        return;
      }

      const intervalMonths = parseInt(invoice.interval_months, 10) || 1;
      const tenantName = invoice.tenant_name;
      const planName = invoice.plan_name || 'Standard';
      const amount = parseFloat(invoice.total_amount);

      let newExpiryDate: Date;

      // Execute transaction: Mark invoice paid, extend subscription, activate tenant, record audit log
      await withTransaction(async (client) => {
        // 1. Update subscription_invoices
        await client.query(
          `
          UPDATE subscription_invoices
          SET status = 'PAID',
              paid_at = NOW(),
              payment_method = $1,
              payment_reference = $2,
              mpesa_phone_number = COALESCE($3, mpesa_phone_number),
              updated_at = NOW()
          WHERE id = $4
          `,
          [method, cleanRef, phoneNumber || null, invoiceId]
        );

        // 2. Fetch current tenant subscription
        const subRes = await client.query(
          `SELECT * FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1`,
          [tenantId]
        );

        const currentSub = subRes.rows[0];

        // Calculate new period end date
        const now = new Date();
        let periodStart = now;
        let periodEnd = new Date(now);

        if (currentSub && currentSub.current_period_end) {
          const currentEnd = new Date(currentSub.current_period_end);
          if (currentEnd > now) {
            // Subscription renewed before expiration: extend existing period
            periodStart = new Date(currentSub.current_period_start || now);
            periodEnd = new Date(currentEnd);
            periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);
          } else {
            // Subscription expired: restart from now
            periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);
          }
        } else {
          periodEnd.setMonth(periodEnd.getMonth() + intervalMonths);
        }

        newExpiryDate = periodEnd;

        // 3. Update or Insert tenant_subscriptions
        if (currentSub) {
          await client.query(
            `
            UPDATE tenant_subscriptions
            SET plan_id = COALESCE($1, plan_id),
                status = 'ACTIVE',
                current_period_start = $2,
                current_period_end = $3,
                mpesa_receipt_no = $4,
                updated_at = NOW()
            WHERE tenant_id = $5
            `,
            [invoice.plan_id, periodStart, periodEnd, cleanRef, tenantId]
          );
        } else {
          await client.query(
            `
            INSERT INTO tenant_subscriptions (
              id, tenant_id, plan_id, status, billing_cycle,
              current_period_start, current_period_end, auto_renew,
              mpesa_receipt_no, updated_at
            ) VALUES (
              gen_random_uuid()::text, $1, $2, 'ACTIVE', 'monthly',
              $3, $4, TRUE,
              $5, NOW()
            )
            `,
            [tenantId, invoice.plan_id, periodStart, periodEnd, cleanRef]
          );
        }

        // 4. Reactivate tenant organization immediately
        await client.query(
          `UPDATE tenants SET is_active = TRUE, updated_at = NOW() WHERE id = $1`,
          [tenantId]
        );

        // 5. Audit log
        await client.query(
          `
          INSERT INTO audit_logs (
            id, tenant_id, action, entity_type, entity_id, description, metadata, created_at
          ) VALUES (
            gen_random_uuid()::text, $1, 'UPDATE', 'TENANT_SUBSCRIPTION', $2, $3, $4, NOW()
          )
          `,
          [
            tenantId,
            invoiceId,
            `Subscription payment confirmed (${cleanRef}) for ${tenantName}. Workspace reactivated until ${periodEnd.toISOString()}.`,
            JSON.stringify({ invoiceNumber: invoice.invoice_number, amount, cleanRef, method }),
          ]
        );
      });

      // 6. Send payment success email to tenant owner
      const ownerRes = await query(
        `SELECT email, first_name, last_name FROM users WHERE tenant_id = $1 AND role = 'TENANT_OWNER' LIMIT 1`,
        [tenantId]
      );

      const ownerEmail = ownerRes.rows[0]?.email || invoice.tenant_email;
      const ownerName = ownerRes.rows[0]?.first_name
        ? `${ownerRes.rows[0].first_name} ${ownerRes.rows[0].last_name || ''}`.trim()
        : tenantName;

      if (ownerEmail) {
        const portalUrl = `${appConfig.appUrl}/dashboard`;
        const emailHtml = emailService.generateSubscriptionPaymentSuccessEmailHtml({
          tenantName,
          recipientName: ownerName,
          planName,
          invoiceNumber: invoice.invoice_number,
          amountPaidFormatted: formatKES(amount),
          paymentMethod: method === 'MPESA_STK' ? 'M-Pesa Express' : (method === 'MPESA_PAYBILL' ? 'M-Pesa Paybill / Till' : method),
          paymentReference: cleanRef,
          newExpiryDateFormatted: newExpiryDate!.toLocaleDateString('en-KE', { dateStyle: 'full' }),
          portalUrl,
        });

        await emailService.sendEmail({
          to: ownerEmail,
          subject: `Payment Confirmed: Subscription Activated for ${tenantName}`,
          html: emailHtml,
        });

        subLogger.info(`📧 Dispatched payment confirmation email to ${ownerEmail} for ${tenantName}`);
      }

      req.flash('success', `Payment received successfully! Your subscription for ${planName} is active and full workspace access is unlocked.`);

      res.json({
        success: true,
        message: 'Payment confirmed! Workspace active.',
        redirectUrl: '/dashboard',
      });
    } catch (error: any) {
      subLogger.error('Payment verification failed', { error: error.message });
      res.status(500).json({ success: false, message: 'Payment processing failed. Please try again.' });
    }
  };

  /**
   * Check status of a subscription invoice (for polling after STK push)
   */
  checkInvoiceStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { invoiceId } = req.params;
      const tenantId = req.tenantId;

      const resInvoice = await query(
        `SELECT id, status, payment_reference, paid_at FROM subscription_invoices WHERE id = $1 AND tenant_id = $2`,
        [invoiceId, tenantId]
      );

      if (resInvoice.rows.length === 0) {
        res.status(404).json({ success: false, message: 'Invoice not found' });
        return;
      }

      const inv = resInvoice.rows[0];
      res.json({
        success: true,
        isPaid: inv.status === 'PAID',
        status: inv.status,
        paymentReference: inv.payment_reference,
        paidAt: inv.paid_at,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Status check failed' });
    }
  };

  /**
   * Change Subscription Plan (Upgrade/Downgrade)
   */
  changePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      const { planId } = req.body;

      if (!tenantId || !planId) {
        req.flash('error', 'Plan selection is required.');
        res.redirect('/subscription');
        return;
      }

      const plan = await SubscriptionModel.findPlanById(planId);
      if (!plan || !plan.isActive) {
        req.flash('error', 'Selected subscription plan is not available.');
        res.redirect('/subscription');
        return;
      }

      // Redirect to payment page for the new plan
      res.redirect(`/subscription/pay?planId=${planId}`);
    } catch (error) {
      subLogger.error('Failed to change subscription plan', { error: String(error) });
      next(error);
    }
  };

  /**
   * Cancel Tenant Subscription
   * When cancelled, tenant cannot create new transactions, print, or download invoices/quotations
   * until renewed by paying for a plan.
   */
  cancelSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        req.flash('error', 'Organization context required.');
        res.redirect('/auth/login');
        return;
      }

      const tenant = await TenantModel.findById(tenantId);
      if (!tenant) {
        req.flash('error', 'Organization not found.');
        res.redirect('/subscription');
        return;
      }

      if (tenant.subscriptionExempt) {
        req.flash('info', 'Your organization is whitelisted from subscription fees and does not need cancellation.');
        res.redirect('/subscription');
        return;
      }

      await withTransaction(async (client) => {
        // Set subscription status to CANCELLED and auto_renew to FALSE
        await client.query(
          `UPDATE tenant_subscriptions 
           SET status = 'CANCELLED', auto_renew = FALSE, updated_at = NOW() 
           WHERE tenant_id = $1`,
          [tenantId]
        );

        // Record Audit Log
        await client.query(
          `INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, description, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'UPDATE', 'TenantSubscription', $1, $3, NOW())`,
          [
            tenantId,
            req.user?.id,
            `User "${req.user?.firstName || 'Owner'}" cancelled the organization subscription. New transactions and document downloads/printing are restricted until renewal.`,
          ]
        );
      });

      req.flash(
        'warning',
        'Your subscription has been cancelled. Creating new transactions (invoices, quotations, expenses) and printing or downloading documents is restricted until you renew your subscription.'
      );
      res.redirect('/subscription');
    } catch (error) {
      subLogger.error('Failed to cancel subscription', { error: String(error) });
      req.flash('error', 'Failed to cancel subscription: ' + (error instanceof Error ? error.message : String(error)));
      res.redirect('/subscription');
    }
  };
}

export const subscriptionController = new SubscriptionController();
export default subscriptionController;
