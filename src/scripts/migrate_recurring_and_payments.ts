import { query } from '../config/database';
import logger from '../utils/logger';

async function migrate() {
  console.log('Running migration: Recurring Invoices, Payment Gateways & Receipts...');

  // 1. Invoices table additions
  await query(`
    ALTER TABLE invoices 
    ADD COLUMN IF NOT EXISTS public_token VARCHAR(64) UNIQUE DEFAULT gen_random_uuid()::text,
    ADD COLUMN IF NOT EXISTS recurring_schedule_id VARCHAR(64) REFERENCES maintenance_schedules(id) ON DELETE SET NULL;
  `);

  // Backfill existing invoices with public_token if null
  await query(`
    UPDATE invoices SET public_token = gen_random_uuid()::text WHERE public_token IS NULL;
  `);

  // 2. Maintenance schedules table additions
  await query(`
    ALTER TABLE maintenance_schedules 
    ADD COLUMN IF NOT EXISTS interval_months INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS auto_send_email BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS last_invoice_id VARCHAR(64) REFERENCES invoices(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 16,
    ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;
  `);

  // 3. Tenants table additions for payment configuration & receipt customization
  await query(`
    ALTER TABLE tenants 
    ADD COLUMN IF NOT EXISTS daraja_environment VARCHAR(20) NOT NULL DEFAULT 'sandbox',
    ADD COLUMN IF NOT EXISTS card_gateway_provider VARCHAR(50) NOT NULL DEFAULT 'STRIPE',
    ADD COLUMN IF NOT EXISTS card_public_key TEXT,
    ADD COLUMN IF NOT EXISTS card_secret_key TEXT,
    ADD COLUMN IF NOT EXISTS card_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS receipt_fields JSONB DEFAULT '{
      "showTenantKraPin": true,
      "showBankDetails": true,
      "showMpesaRef": true,
      "showProject": true,
      "showClientPhone": true,
      "showClientAddress": true,
      "showNotes": true,
      "receiptFooterNote": "Thank you for your business. For any queries, contact accounts."
    }'::jsonb;
  `);

  // 4. Payments table additions
  await query(`
    ALTER TABLE payments 
    ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(100) UNIQUE,
    ADD COLUMN IF NOT EXISTS card_last4 VARCHAR(10),
    ADD COLUMN IF NOT EXISTS card_brand VARCHAR(50),
    ADD COLUMN IF NOT EXISTS payment_gateway VARCHAR(50) DEFAULT 'MPESA';
  `);

  // Backfill any existing completed payments with receipt numbers
  await query(`
    UPDATE payments 
    SET receipt_number = 'REC-' || TO_CHAR(created_at, 'YYYY') || '-' || LPAD(SUBSTRING(id FROM 1 FOR 6), 6, '0')
    WHERE receipt_number IS NULL;
  `);

  console.log('✅ Migration completed successfully!');
}

export { migrate, migrate as runMigration };

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
