// ══════════════════════════════════════════════════════════════════════
// Deploy Init Script - One-Command Deployment Database Initializer
// 1. Applies all migrations (base schema + enums + tables)
// 2. Prepares clean database baseline (Plans + Super Admin)
// ══════════════════════════════════════════════════════════════════════

import { pool } from '../config/database';
import { runMigration } from './migrate';
import { cleanDatabase } from './cleanDatabase';
import logger from '../utils/logger';

const deployLogger = logger.child('DeployInit');

export async function deployInit(): Promise<void> {
  console.log('🚀 Starting Deployment Database Initialization...\n');

  try {
    // Step 1: Run all migrations without closing pool
    console.log('Step 1/2: Running database migrations...');
    await runMigration(false);
    console.log('✅ Migrations applied successfully.\n');

    // Step 2: Clean and establish baseline
    console.log('Step 2/2: Cleaning and establishing baseline data...');
    await cleanDatabase(false);
    console.log('✅ Baseline established successfully.\n');

    console.log('🎉 Database is fully initialized and production-ready for deployment!');
  } catch (error: any) {
    deployLogger.error('❌ Deployment initialization failed', { error: error.message });
    console.error('❌ Deployment initialization failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  deployInit()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default deployInit;
