// ══════════════════════════════════════════════════════════════════════
// Migration: Subscription Management, Payment Gateways & Reminder Logs
// ══════════════════════════════════════════════════════════════════════

import { query } from '../config/database';
import appConfig from '../config/app';

export async function runMigration() {
  console.log('🚀 Running migration: Subscription Management & Payment Gateways...');

  try {
    // 1. Create platform_payment_settings table
    await query(`
      CREATE TABLE IF NOT EXISTS platform_payment_settings (
        id VARCHAR(64) PRIMARY KEY DEFAULT 'default',
        mpesa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        mpesa_environment VARCHAR(50) NOT NULL DEFAULT 'production',
        mpesa_shortcode VARCHAR(50) NOT NULL DEFAULT '4814641',
        mpesa_shortcode_type VARCHAR(50) NOT NULL DEFAULT 'PAYBILL',
        mpesa_consumer_key TEXT,
        mpesa_consumer_secret TEXT,
        mpesa_passkey TEXT,
        mpesa_callback_url TEXT,
        card_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        card_provider VARCHAR(50) NOT NULL DEFAULT 'STRIPE',
        card_public_key TEXT,
        card_secret_key TEXT,
        bank_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        bank_name VARCHAR(100) DEFAULT 'NCBA Bank Kenya / Equity Bank',
        bank_account_name VARCHAR(255) DEFAULT 'Free Style Code Technologies Ltd',
        bank_account_number VARCHAR(100) DEFAULT '0140 8920 1820',
        bank_instructions TEXT DEFAULT 'Pay to NCBA Bank Kenya / Equity Bank. Account Name: Free Style Code Technologies Ltd. Account Number: 0140 8920 1820. Use your Invoice Number as reference.',
        manual_pesa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Created platform_payment_settings table');

    // 2. Seed initial default row if none exists
    const settingsCheck = await query('SELECT id FROM platform_payment_settings WHERE id = $1', ['default']);
    if (settingsCheck.rows.length === 0) {
      await query(`
        INSERT INTO platform_payment_settings (
          id, mpesa_enabled, mpesa_environment, mpesa_shortcode, mpesa_shortcode_type,
          mpesa_consumer_key, mpesa_consumer_secret, mpesa_passkey, mpesa_callback_url,
          card_enabled, bank_enabled, manual_pesa_enabled
        ) VALUES (
          'default',
          TRUE,
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          FALSE,
          TRUE,
          TRUE
        )
      `, [
        appConfig.daraja.environment || 'production',
        appConfig.daraja.shortcode || '4814641',
        appConfig.daraja.shortcodeType || 'PAYBILL',
        appConfig.daraja.consumerKey || '',
        appConfig.daraja.consumerSecret || '',
        appConfig.daraja.passkey || '',
        appConfig.daraja.callbackUrl || '',
      ]);
      console.log('✅ Seeded default platform payment settings');
    }

    // 3. Create subscription_reminder_logs table
    await query(`
      CREATE TABLE IF NOT EXISTS subscription_reminder_logs (
        id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subscription_id VARCHAR(64) NOT NULL REFERENCES tenant_subscriptions(id) ON DELETE CASCADE,
        days_remaining INT NOT NULL,
        sent_date DATE NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_sub_reminder_daily UNIQUE (subscription_id, sent_date)
      );

      CREATE INDEX IF NOT EXISTS idx_sub_reminder_sub_date ON subscription_reminder_logs(subscription_id, sent_date);
      CREATE INDEX IF NOT EXISTS idx_sub_reminder_tenant ON subscription_reminder_logs(tenant_id);
    `);
    console.log('✅ Created subscription_reminder_logs table with UNIQUE (subscription_id, sent_date)');

    // 4. Update subscription_invoices table with additional columns
    await query(`
      ALTER TABLE subscription_invoices
      ADD COLUMN IF NOT EXISTS mpesa_checkout_request_id VARCHAR(100),
      ADD COLUMN IF NOT EXISTS mpesa_phone_number VARCHAR(50),
      ADD COLUMN IF NOT EXISTS payment_notes TEXT;
    `);
    console.log('✅ Updated subscription_invoices table');

    // 5. Update tenant_subscriptions table with last_reminder_sent_at
    await query(`
      ALTER TABLE tenant_subscriptions
      ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;
    `);
    console.log('✅ Updated tenant_subscriptions table');

    console.log('🎉 Migration finished successfully!');
  } catch (err: any) {
    console.error('❌ Migration failed:', err);
    throw err;
  }
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
