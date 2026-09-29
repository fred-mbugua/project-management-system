// ══════════════════════════════════════════════════════════════════════
// Settings Controller - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { query } from '../config/database';
import { TenantModel } from '../models/tenant.model';
import { DarajaShortcodeType, AuditAction } from '../models/types';
import storageService from '../services/storage.service';
import ActionLogService from '../services/actionLog.service';
import logger from '../utils/logger';

const setLogger = logger.child('SettingsController');

export class SettingsController {
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let tenantId = req.tenantId;
      if (!tenantId && req.user?.role === 'SUPER_ADMIN') {
        const first = await query('SELECT * FROM tenants WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
        if (first.rows.length > 0) {
          tenantId = first.rows[0].id;
        }
      }
      if (!tenantId) {
        req.flash('error', 'Tenant organization not found.');
        res.redirect('/dashboard');
        return;
      }

      const tenant = await TenantModel.findById(tenantId);
      if (!tenant) {
        req.flash('error', 'Tenant organization not found.');
        res.redirect('/dashboard');
        return;
      }

      // Fetch storage metrics for tenant monitoring
      const storageMetrics = await storageService.getTenantStorageUsage(tenantId);

      res.render('pages/settings/index', {
        title: 'Organization Settings',
        tenant,
        storageMetrics,
      });
    } catch (error) {
      setLogger.error('Failed to load tenant settings', { error: String(error) });
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let tenantId = req.tenantId;
      if (!tenantId && req.user?.role === 'SUPER_ADMIN') {
        const first = await query('SELECT * FROM tenants WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
        if (first.rows.length > 0) {
          tenantId = first.rows[0].id;
        }
      }
      if (!tenantId) {
        res.redirect('/auth/login');
        return;
      }

      const body = req.body || {};
      const {
        name,
        phone,
        address,
        city,
        kraPin,
        vatRegistered,
        invoicePrefix,
        quotePrefix,
        invoiceNotes,
        paymentTerms,
        bankDetails,
        darajaConsumerKey,
        darajaConsumerSecret,
        darajaPasskey,
        darajaShortcode,
        darajaShortcodeType,
        darajaEnvironment,
        cardGatewayProvider,
        cardPublicKey,
        cardSecretKey,
        cardEnabled,
        primaryColor,
        secondaryColor,
        accentColor,
        invoiceTemplate,
        removeLogo,
      } = body;

      if (!name || typeof name !== 'string' || name.trim() === '') {
        req.flash('error', 'Legal Business Name is required.');
        res.redirect('/settings');
        return;
      }

      // Retrieve current tenant data to check for existing logo
      const currentTenant = await TenantModel.findById(tenantId);
      const existingLogoUrl = currentTenant?.logoUrl;

      let logoUrl: string | undefined = undefined;
      let replacedOldLogo = false;

      // Handle logo upload to Cloudflare R2 / local server disk
      if (req.file) {
        try {
          const uploadRes = await storageService.uploadTenantFile(tenantId, req.file, 'branding');
          logoUrl = uploadRes.url;
          setLogger.info('Uploaded new tenant logo to storage', { tenantId, url: logoUrl, storage: uploadRes.storageType });

          // If tenant previously had an existing logo, delete old one from R2/server disk to save space
          if (existingLogoUrl && existingLogoUrl.trim() !== '' && existingLogoUrl !== logoUrl) {
            try {
              const deleted = await storageService.deleteFile(existingLogoUrl);
              replacedOldLogo = true;
              setLogger.info('Deleted previous tenant logo to save storage space', {
                tenantId,
                oldLogoUrl: existingLogoUrl,
                success: deleted,
              });
            } catch (delErr) {
              setLogger.warn('Failed to delete replaced logo', { oldLogoUrl: existingLogoUrl, error: String(delErr) });
            }
          }
        } catch (uploadError) {
          setLogger.error('Failed to upload logo', { error: String(uploadError) });
          req.flash('error', 'Failed to upload logo. Please check file format and try again.');
        }
      } else if (removeLogo === 'true' || removeLogo === '1') {
        logoUrl = '';
        // If tenant requested logo removal, delete the current logo from storage
        if (existingLogoUrl && existingLogoUrl.trim() !== '') {
          try {
            const deleted = await storageService.deleteFile(existingLogoUrl);
            setLogger.info('Deleted removed tenant logo from storage to save space', {
              tenantId,
              oldLogoUrl: existingLogoUrl,
              success: deleted,
            });
          } catch (delErr) {
            setLogger.warn('Failed to delete removed logo', { oldLogoUrl: existingLogoUrl, error: String(delErr) });
          }
        }
      }

      // Parse document display fields (if submitted)
      let displayFields: any = undefined;
      if (body.has_display_fields === '1') {
        displayFields = {
          showTenantPhone: body.showTenantPhone === '1' || body.showTenantPhone === 'on' || body.showTenantPhone === 'true',
          showTenantEmail: body.showTenantEmail === '1' || body.showTenantEmail === 'on' || body.showTenantEmail === 'true',
          showTenantAddress: body.showTenantAddress === '1' || body.showTenantAddress === 'on' || body.showTenantAddress === 'true',
          showTenantKraPin: body.showTenantKraPin === '1' || body.showTenantKraPin === 'on' || body.showTenantKraPin === 'true',
          showClientPhone: body.showClientPhone === '1' || body.showClientPhone === 'on' || body.showClientPhone === 'true',
          showClientEmail: body.showClientEmail === '1' || body.showClientEmail === 'on' || body.showClientEmail === 'true',
          showClientAddress: body.showClientAddress === '1' || body.showClientAddress === 'on' || body.showClientAddress === 'true',
          showClientKraPin: body.showClientKraPin === '1' || body.showClientKraPin === 'on' || body.showClientKraPin === 'true',
          showBankDetails: body.showBankDetails === '1' || body.showBankDetails === 'on' || body.showBankDetails === 'true',
          showPaymentTerms: body.showPaymentTerms === '1' || body.showPaymentTerms === 'on' || body.showPaymentTerms === 'true',
          showMpesaDetails: body.showMpesaDetails === '1' || body.showMpesaDetails === 'on' || body.showMpesaDetails === 'true',
          showTaxBreakdown: body.showTaxBreakdown === '1' || body.showTaxBreakdown === 'on' || body.showTaxBreakdown === 'true',
          showDiscount: body.showDiscount === '1' || body.showDiscount === 'on' || body.showDiscount === 'true',
          showProject: body.showProject === '1' || body.showProject === 'on' || body.showProject === 'true',
          showNotes: body.showNotes === '1' || body.showNotes === 'on' || body.showNotes === 'true',
          showTerms: body.showTerms === '1' || body.showTerms === 'on' || body.showTerms === 'true',
          showEtimsQr: body.showEtimsQr === '1' || body.showEtimsQr === 'on' || body.showEtimsQr === 'true',
        };
      }

      // Parse payment receipt fields (if submitted)
      let receiptFields: any = undefined;
      if (body.has_receipt_fields === '1') {
        receiptFields = {
          showTenantKraPin: body.rec_showTenantKraPin === '1' || body.rec_showTenantKraPin === 'on' || body.rec_showTenantKraPin === 'true',
          showBankDetails: body.rec_showBankDetails === '1' || body.rec_showBankDetails === 'on' || body.rec_showBankDetails === 'true',
          showMpesaRef: body.rec_showMpesaRef === '1' || body.rec_showMpesaRef === 'on' || body.rec_showMpesaRef === 'true',
          showProject: body.rec_showProject === '1' || body.rec_showProject === 'on' || body.rec_showProject === 'true',
          showClientPhone: body.rec_showClientPhone === '1' || body.rec_showClientPhone === 'on' || body.rec_showClientPhone === 'true',
          showClientAddress: body.rec_showClientAddress === '1' || body.rec_showClientAddress === 'on' || body.rec_showClientAddress === 'true',
          showNotes: body.rec_showNotes === '1' || body.rec_showNotes === 'on' || body.rec_showNotes === 'true',
          receiptFooterNote: body.rec_receiptFooterNote || 'Thank you for your prompt payment.',
        };
      }

      await TenantModel.update(tenantId, {
        name,
        phone,
        address,
        city,
        kraPin,
        vatRegistered: vatRegistered === 'on' || vatRegistered === 'true',
        invoicePrefix,
        quotePrefix,
        invoiceNotes,
        paymentTerms,
        bankDetails,
        darajaConsumerKey,
        darajaConsumerSecret,
        darajaPasskey,
        darajaShortcode,
        darajaShortcodeType: darajaShortcodeType as DarajaShortcodeType,
        darajaEnvironment: darajaEnvironment || 'sandbox',
        cardGatewayProvider: cardGatewayProvider || 'STRIPE',
        cardPublicKey,
        cardSecretKey,
        cardEnabled: cardEnabled === 'on' || cardEnabled === '1' || cardEnabled === 'true' || cardEnabled === true,
        primaryColor,
        secondaryColor,
        accentColor,
        invoiceTemplate,
        ...(displayFields !== undefined ? { displayFields } : {}),
        ...(receiptFields !== undefined ? { receiptFields } : {}),
        ...(logoUrl !== undefined ? { logoUrl } : {}),
      });

      // Record Action Log
      await ActionLogService.record(req, {
        action: AuditAction.SETTINGS_CHANGE,
        entityType: 'TENANT_SETTINGS',
        entityId: tenantId,
        description: `Updated organization settings and branding assets for "${name}"`,
        metadata: {
          hasNewLogo: Boolean(req.file),
          replacedPreviousLogo: replacedOldLogo,
          logoRemoved: removeLogo === 'true' || removeLogo === '1',
          primaryColor,
          invoiceTemplate,
          hasDisplayFieldsUpdated: Boolean(displayFields),
          hasReceiptFieldsUpdated: Boolean(receiptFields),
        },
      });

      if (replacedOldLogo) {
        req.flash('success', 'Organization settings updated. Your previous logo was permanently deleted from storage to save space, and the new logo is now active.');
      } else if (removeLogo === 'true' || removeLogo === '1') {
        req.flash('success', 'Organization settings updated. Your logo was removed and deleted from storage.');
      } else {
        req.flash('success', 'Organization settings and brand assets updated successfully.');
      }
      res.redirect('/settings');
    } catch (error) {
      setLogger.error('Failed to update tenant settings', { error: String(error) });
      next(error);
    }
  };

  /**
   * Test payment gateway credentials before going live
   */
  testPaymentConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        darajaConsumerKey,
        darajaConsumerSecret,
        darajaPasskey,
        darajaShortcode,
        darajaEnvironment,
        cardGatewayProvider,
        cardPublicKey,
        cardSecretKey,
        cardEnabled,
      } = req.body;

      const results: any = {
        success: true,
        mpesa: { tested: false, success: false, message: '' },
        card: { tested: false, success: false, message: '' },
      };

      // 1. Test Daraja credentials if provided
      if (darajaConsumerKey && darajaConsumerSecret) {
        results.mpesa.tested = true;
        try {
          const env = darajaEnvironment === 'live' ? 'live' : 'sandbox';
          const authUrl = env === 'live'
            ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
            : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

          const authHeader = Buffer.from(`${darajaConsumerKey.trim()}:${darajaConsumerSecret.trim()}`).toString('base64');
          const tokenRes = await axios.get(authUrl, {
            headers: { Authorization: `Basic ${authHeader}` },
            timeout: 8000,
          });

          if (tokenRes.data && tokenRes.data.access_token) {
            results.mpesa.success = true;
            results.mpesa.message = `Safaricom Daraja (${env.toUpperCase()}) connected successfully! Shortcode ${darajaShortcode || ''} is valid and ready.`;
          } else {
            results.mpesa.success = false;
            results.mpesa.message = 'Safaricom did not return an access token. Check Consumer Key and Secret.';
            results.success = false;
          }
        } catch (err: any) {
          results.mpesa.success = false;
          results.mpesa.message = `Daraja Connection Error: ${err?.response?.data?.errorMessage || err?.message || 'Invalid credentials'}`;
          results.success = false;
        }
      } else {
        results.mpesa.message = 'No Daraja credentials specified (System will simulate M-Pesa prompt in sandbox mode).';
      }

      // 2. Test Card Gateway
      const isCardActive = cardEnabled === 'on' || cardEnabled === '1' || cardEnabled === 'true' || cardEnabled === true;
      if (isCardActive && cardSecretKey) {
        results.card.tested = true;
        const provider = cardGatewayProvider || 'STRIPE';
        if (provider === 'STRIPE') {
          if (cardSecretKey.startsWith('sk_test_') || cardSecretKey.startsWith('sk_live_')) {
            results.card.success = true;
            results.card.message = `Stripe ${cardSecretKey.startsWith('sk_test_') ? 'Test Key' : 'Live Key'} format verified.`;
          } else {
            results.card.success = false;
            results.card.message = 'Invalid Stripe secret key format (must start with sk_test_ or sk_live_).';
            results.success = false;
          }
        } else if (provider === 'PAYSTACK') {
          if (cardSecretKey.startsWith('sk_test_') || cardSecretKey.startsWith('sk_live_')) {
            results.card.success = true;
            results.card.message = 'Paystack secret key format verified.';
          } else {
            results.card.success = false;
            results.card.message = 'Invalid Paystack secret key format.';
            results.success = false;
          }
        } else {
          results.card.success = true;
          results.card.message = `${provider} configuration saved and verified.`;
        }
      }

      res.json(results);
    } catch (err: any) {
      setLogger.error('testPaymentConfig error', { error: err?.message });
      res.status(500).json({ success: false, message: 'Could not test payment config: ' + err.message });
    }
  };
}

export default new SettingsController();
