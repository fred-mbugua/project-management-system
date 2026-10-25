// ══════════════════════════════════════════════════════════════════════
// Database Migration Runner - Raw PostgreSQL
// Reads src/models/schema.sql and applies incremental migrations
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { query, pool } from '../config/database';
import logger from '../utils/logger';
import { runMigration as runRecurringMigration } from './migrate_recurring_and_payments';
import { runMigration as runSubscriptionsMigration } from './migrate_subscriptions_and_manual_payments';
import { runMigration as runUserPermissionsMigration } from './migrate_user_permissions';
import { runMigration as runSubscriptionManagementMigration } from './migrate_subscription_management';
import { runMigration as runPayPalMigration } from './migrate_paypal_settings';
import { runMigration as runWhitelistMigration } from './migrate_whitelist_and_cancellation';

const migrateLogger = logger.child('Migrate');

export async function runMigration(closePool: boolean = true): Promise<void> {
  const schemaPath = path.join(__dirname, '..', 'models', 'schema.sql');
  migrateLogger.info('Starting database migration...', { schemaPath });

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await query(sql);
    migrateLogger.info('✅ Base database schema applied successfully!');

    // Run incremental migrations to guarantee all columns and enums are up to date
    await runRecurringMigration();
    await runSubscriptionsMigration();
    await runUserPermissionsMigration();
    await runSubscriptionManagementMigration();
    await runPayPalMigration();
    await runWhitelistMigration();

    migrateLogger.info('✅ All database migrations completed successfully!');
  } catch (error: any) {
    migrateLogger.error('❌ Migration failed', { error: error.message });
    throw error;
  } finally {
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  runMigration(true)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default runMigration;
