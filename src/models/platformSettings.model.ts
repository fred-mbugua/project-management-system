// ══════════════════════════════════════════════════════════════════════
// Platform Payment Settings Model
// Platform-wide payment methods configured by SUPER_ADMIN for subscriptions
// ══════════════════════════════════════════════════════════════════════

import { query } from '../config/database';
import appConfig from '../config/app';

export interface PlatformPaymentSettings {
  id: string;
  mpesaEnabled: boolean;
  mpesaEnvironment: 'sandbox' | 'production';
  mpesaShortcode: string;
  mpesaShortcodeType: 'PAYBILL' | 'TILL';
  mpesaConsumerKey: string;
  mpesaConsumerSecret: string;
  mpesaPasskey: string;
  mpesaCallbackUrl: string;
  cardEnabled: boolean;
  cardProvider: 'STRIPE' | 'PAYSTACK' | 'FLUTTERWAVE';
  cardPublicKey: string;
  cardSecretKey: string;
  bankEnabled: boolean;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankInstructions: string;
  manualPesaEnabled: boolean;
  updatedAt: Date;
}

export class PlatformPaymentSettingsModel {
  private static mapRow(row: any): PlatformPaymentSettings {
    return {
      id: row.id || 'default',
      mpesaEnabled: row.mpesa_enabled !== false,
      mpesaEnvironment: (row.mpesa_environment || appConfig.daraja.environment || 'production') as 'sandbox' | 'production',
      mpesaShortcode: row.mpesa_shortcode || appConfig.daraja.shortcode || '4814641',
      mpesaShortcodeType: (row.mpesa_shortcode_type || appConfig.daraja.shortcodeType || 'PAYBILL') as 'PAYBILL' | 'TILL',
      mpesaConsumerKey: row.mpesa_consumer_key || appConfig.daraja.consumerKey || '',
      mpesaConsumerSecret: row.mpesa_consumer_secret || appConfig.daraja.consumerSecret || '',
      mpesaPasskey: row.mpesa_passkey || appConfig.daraja.passkey || '',
      mpesaCallbackUrl: row.mpesa_callback_url || appConfig.daraja.callbackUrl || '',
      cardEnabled: row.card_enabled === true,
      cardProvider: (row.card_provider || 'STRIPE') as 'STRIPE' | 'PAYSTACK' | 'FLUTTERWAVE',
      cardPublicKey: row.card_public_key || '',
      cardSecretKey: row.card_secret_key || '',
      bankEnabled: row.bank_enabled !== false,
      bankName: row.bank_name || 'NCBA Bank Kenya / Equity Bank',
      bankAccountName: row.bank_account_name || 'Free Style Code Technologies Ltd',
      bankAccountNumber: row.bank_account_number || '0140 8920 1820',
      bankInstructions: row.bank_instructions || 'Pay to NCBA Bank Kenya / Equity Bank. Account Name: Free Style Code Technologies Ltd. Account Number: 0140 8920 1820. Use your Invoice Number as reference.',
      manualPesaEnabled: row.manual_pesa_enabled !== false,
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }

  /**
   * Get current platform payment settings
   */
  static async getSettings(): Promise<PlatformPaymentSettings> {
    try {
      const res = await query('SELECT * FROM platform_payment_settings WHERE id = $1 LIMIT 1', ['default']);
      if (res.rows.length > 0) {
        return this.mapRow(res.rows[0]);
      }
    } catch (err) {
      // Table may not exist yet or query failed, return fallback
    }

    // Default fallback from appConfig
    return {
      id: 'default',
      mpesaEnabled: true,
      mpesaEnvironment: (appConfig.daraja.environment as any) || 'production',
      mpesaShortcode: appConfig.daraja.shortcode || '4814641',
      mpesaShortcodeType: (appConfig.daraja.shortcodeType as any) || 'PAYBILL',
      mpesaConsumerKey: appConfig.daraja.consumerKey || '',
      mpesaConsumerSecret: appConfig.daraja.consumerSecret || '',
      mpesaPasskey: appConfig.daraja.passkey || '',
      mpesaCallbackUrl: appConfig.daraja.callbackUrl || '',
      cardEnabled: false,
      cardProvider: 'STRIPE',
      cardPublicKey: '',
      cardSecretKey: '',
      bankEnabled: true,
      bankName: 'NCBA Bank Kenya / Equity Bank',
      bankAccountName: 'Free Style Code Technologies Ltd',
      bankAccountNumber: '0140 8920 1820',
      bankInstructions: 'Pay to NCBA Bank Kenya / Equity Bank. Account Name: Free Style Code Technologies Ltd. Account Number: 0140 8920 1820. Use your Invoice Number as reference.',
      manualPesaEnabled: true,
      updatedAt: new Date(),
    };
  }

  /**
   * Update platform payment settings (SUPER_ADMIN only)
   */
  static async updateSettings(data: Partial<PlatformPaymentSettings>): Promise<PlatformPaymentSettings> {
    const current = await this.getSettings();

    const sql = `
      INSERT INTO platform_payment_settings (
        id, mpesa_enabled, mpesa_environment, mpesa_shortcode, mpesa_shortcode_type,
        mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_callback_url,
        card_enabled, card_provider, card_public_key, card_secret_key,
        bank_enabled, bank_name, bank_account_name, bank_account_number, bank_instructions,
        manual_pesa_enabled, updated_at
      ) VALUES (
        'default', $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        mpesa_enabled = EXCLUDED.mpesa_enabled,
        mpesa_environment = EXCLUDED.mpesa_environment,
        mpesa_shortcode = EXCLUDED.mpesa_shortcode,
        mpesa_shortcode_type = EXCLUDED.mpesa_shortcode_type,
        mpesa_consumer_key = EXCLUDED.mpesa_consumer_key,
        mpesa_consumer_secret = EXCLUDED.mpesa_consumer_secret,
        mpesa_passkey = EXCLUDED.mpesa_passkey,
        mpesa_callback_url = EXCLUDED.mpesa_callback_url,
        card_enabled = EXCLUDED.card_enabled,
        card_provider = EXCLUDED.card_provider,
        card_public_key = EXCLUDED.card_public_key,
        card_secret_key = EXCLUDED.card_secret_key,
        bank_enabled = EXCLUDED.bank_enabled,
        bank_name = EXCLUDED.bank_name,
        bank_account_name = EXCLUDED.bank_account_name,
        bank_account_number = EXCLUDED.bank_account_number,
        bank_instructions = EXCLUDED.bank_instructions,
        manual_pesa_enabled = EXCLUDED.manual_pesa_enabled,
        updated_at = NOW()
      RETURNING *
    `;

    const values = [
      data.mpesaEnabled !== undefined ? data.mpesaEnabled : current.mpesaEnabled,
      data.mpesaEnvironment !== undefined ? data.mpesaEnvironment : current.mpesaEnvironment,
      data.mpesaShortcode !== undefined ? data.mpesaShortcode : current.mpesaShortcode,
      data.mpesaShortcodeType !== undefined ? data.mpesaShortcodeType : current.mpesaShortcodeType,
      data.mpesaConsumerKey !== undefined ? data.mpesaConsumerKey : current.mpesaConsumerKey,
      data.mpesaConsumerSecret !== undefined ? data.mpesaConsumerSecret : current.mpesaConsumerSecret,
      data.mpesaPasskey !== undefined ? data.mpesaPasskey : current.mpesaPasskey,
      data.mpesaCallbackUrl !== undefined ? data.mpesaCallbackUrl : current.mpesaCallbackUrl,
      data.cardEnabled !== undefined ? data.cardEnabled : current.cardEnabled,
      data.cardProvider !== undefined ? data.cardProvider : current.cardProvider,
      data.cardPublicKey !== undefined ? data.cardPublicKey : current.cardPublicKey,
      data.cardSecretKey !== undefined ? data.cardSecretKey : current.cardSecretKey,
      data.bankEnabled !== undefined ? data.bankEnabled : current.bankEnabled,
      data.bankName !== undefined ? data.bankName : current.bankName,
      data.bankAccountName !== undefined ? data.bankAccountName : current.bankAccountName,
      data.bankAccountNumber !== undefined ? data.bankAccountNumber : current.bankAccountNumber,
      data.bankInstructions !== undefined ? data.bankInstructions : current.bankInstructions,
      data.manualPesaEnabled !== undefined ? data.manualPesaEnabled : current.manualPesaEnabled,
    ];

    const res = await query(sql, values);
    return this.mapRow(res.rows[0]);
  }
}

export default PlatformPaymentSettingsModel;
