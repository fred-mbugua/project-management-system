// ══════════════════════════════════════════════════════════════════════
// Migration: Subscription Fee Whitelist & Cancellation Support
// ══════════════════════════════════════════════════════════════════════

import { query } from '../config/database';

export async function runMigration() {
  console.log('🚀 Running migration: Subscription Fee Whitelist & Cancellation...');

  try {
    // 1. Add subscription_exempt column to tenants table
    await query(`
      ALTER TABLE tenants 
      ADD COLUMN IF NOT EXISTS subscription_exempt BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    console.log('✅ Added subscription_exempt column to tenants table');

    // 2. Index for filtering fee-exempt tenants quickly
    await query(`
      CREATE INDEX IF NOT EXISTS idx_tenants_subscription_exempt ON tenants(subscription_exempt);
    `);
    console.log('✅ Created index on tenants(subscription_exempt)');

    // 3. Ensure subscription_status enum has CANCELLED, CANCELED, SUSPENDED, EXPIRED
    try {
      await query(`ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'CANCELLED';`);
      console.log('✅ Verified subscription_status has CANCELLED');
    } catch (e: any) {
      console.log('ℹ️ Note on CANCELLED enum:', e.message);
    }

    try {
      await query(`ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'CANCELED';`);
      console.log('✅ Verified subscription_status has CANCELED');
    } catch (e: any) {
      console.log('ℹ️ Note on CANCELED enum:', e.message);
    }

    try {
      await query(`ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'SUSPENDED';`);
      console.log('✅ Verified subscription_status has SUSPENDED');
    } catch (e: any) {
      console.log('ℹ️ Note on SUSPENDED enum:', e.message);
    }

    try {
      await query(`ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'EXPIRED';`);
      console.log('✅ Verified subscription_status has EXPIRED');
    } catch (e: any) {
      console.log('ℹ️ Note on EXPIRED enum:', e.message);
    }

    console.log('🎉 Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    throw err;
  }
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
