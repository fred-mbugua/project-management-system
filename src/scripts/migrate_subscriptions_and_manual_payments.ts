import { query } from '../config/database';

export async function runMigration() {
  console.log('Running migration: Subscriptions, Custom Intervals, Manual Payments & Proof Uploads...');

  try {
    // 1. Update subscription_status enum
    await query(`
      ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'SUSPENDED';
      ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS 'EXPIRED';
    `);
    console.log('✅ Added SUSPENDED and EXPIRED to subscription_status enum');
  } catch (err: any) {
    console.log('Note on subscription_status enum:', err?.message);
  }

  try {
    // 2. Update payment_method enum
    await query(`
      ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'MANUAL';
      ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'OTHER';
    `);
    console.log('✅ Added MANUAL and OTHER to payment_method enum');
  } catch (err: any) {
    console.log('Note on payment_method enum:', err?.message);
  }

  // 3. Update subscription_plans table
  await query(`
    ALTER TABLE subscription_plans
    ADD COLUMN IF NOT EXISTS frequency VARCHAR(50) DEFAULT 'MONTHLY',
    ADD COLUMN IF NOT EXISTS interval_months INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);
  console.log('✅ Updated subscription_plans table with frequency, interval_months, price, description');

  // 4. Update payments table with proof document columns
  await query(`
    ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS proof_url TEXT,
    ADD COLUMN IF NOT EXISTS proof_filename VARCHAR(255),
    ADD COLUMN IF NOT EXISTS recorded_by_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL;
  `);
  console.log('✅ Updated payments table with proof_url, proof_filename, recorded_by_user_id');

  // 5. Create subscription_invoices table for platform SaaS subscription billings
  await query(`
    CREATE TABLE IF NOT EXISTS subscription_invoices (
      id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      plan_id VARCHAR(64) REFERENCES subscription_plans(id) ON DELETE SET NULL,
      invoice_number VARCHAR(100) NOT NULL UNIQUE,
      amount NUMERIC(12, 2) NOT NULL,
      tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      total_amount NUMERIC(12, 2) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'UNPAID',
      billing_period_start TIMESTAMPTZ NOT NULL,
      billing_period_end TIMESTAMPTZ NOT NULL,
      due_date TIMESTAMPTZ NOT NULL,
      paid_at TIMESTAMPTZ,
      payment_method VARCHAR(50),
      payment_reference VARCHAR(100),
      payment_instructions TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sub_invoices_tenant ON subscription_invoices(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sub_invoices_status ON subscription_invoices(status);
  `);
  console.log('✅ Created subscription_invoices table');

  console.log('🎉 Migration completed successfully!');
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
