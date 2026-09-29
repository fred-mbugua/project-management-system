// ══════════════════════════════════════════════════════════════════════
// Migration: Add PayPal Business Gateway Support to Platform Payment Settings
// ══════════════════════════════════════════════════════════════════════

import { query } from '../config/database';

export async function runMigration() {
  console.log('🚀 Running migration: PayPal Business Payment Integration...');

  try {
    // 1. Add PAYPAL to payment_method enum if not exists
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t 
          JOIN pg_enum e ON t.oid = e.enumtypid 
          WHERE t.typname = 'payment_method' AND e.enumlabel = 'PAYPAL'
        ) THEN
          ALTER TYPE payment_method ADD VALUE 'PAYPAL';
        END IF;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log('✅ Added PAYPAL to payment_method enum');
  } catch (err: any) {
    console.log('Note on payment_method enum:', err?.message);
  }

  try {
    // 2. Add PayPal columns to platform_payment_settings
    await query(`
      ALTER TABLE platform_payment_settings
      ADD COLUMN IF NOT EXISTS paypal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS paypal_environment VARCHAR(50) NOT NULL DEFAULT 'sandbox',
      ADD COLUMN IF NOT EXISTS paypal_business_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS paypal_client_id TEXT,
      ADD COLUMN IF NOT EXISTS paypal_client_secret TEXT,
      ADD COLUMN IF NOT EXISTS paypal_currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      ADD COLUMN IF NOT EXISTS paypal_exchange_rate NUMERIC(10, 2) NOT NULL DEFAULT 130.00;
    `);
    console.log('✅ Added PayPal configuration columns to platform_payment_settings');
  } catch (err: any) {
    console.error('Error adding PayPal columns:', err?.message);
    throw err;
  }

  console.log('🎉 PayPal migration completed successfully!');
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('PayPal migration failed:', err);
      process.exit(1);
    });
}
