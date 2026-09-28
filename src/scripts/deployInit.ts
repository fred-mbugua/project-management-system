// ══════════════════════════════════════════════════════════════════════
// Deploy Init Script - One-Command Deployment Database Initializer
// 1. Applies all migrations (base schema + enums + tables)
// 2. Prepares clean database baseline (Plans + Super Admin)
// ══════════════════════════════════════════════════════════════════════

import { Client } from 'pg';
import appConfig from '../config/app';
import { pool } from '../config/database';
import { runMigration } from './migrate';
import { cleanDatabase } from './cleanDatabase';
import logger from '../utils/logger';

const deployLogger = logger.child('DeployInit');

async function ensureDatabaseExists(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || appConfig.databaseUrl;
  if (!dbUrl) return;

  try {
    const parsed = new URL(dbUrl);
    const targetDb = parsed.pathname.replace(/^\//, '').split('?')[0];

    // Try a direct probe to see if target DB already exists
    const probe = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 3000 });
    try {
      await probe.connect();
      await probe.end();
      return; // Database exists
    } catch (probeErr: any) {
      // 3D000 = database does not exist
      if (probeErr.code === '3D000' || (probeErr.message && probeErr.message.includes('does not exist'))) {
        console.log(`📦 Database "${targetDb}" does not exist yet. Attempting auto-creation...`);
        parsed.pathname = '/postgres';
        parsed.search = '';
        const maintenanceClient = new Client({ connectionString: parsed.toString(), connectionTimeoutMillis: 5000 });
        try {
          await maintenanceClient.connect();
          await maintenanceClient.query(`CREATE DATABASE "${targetDb}"`);
          console.log(`   ✅ Database "${targetDb}" created successfully!\n`);
        } catch (mErr: any) {
          console.warn(`   ⚠️  Auto-create note: ${mErr.message}`);
          console.warn(`   👉 If deploy fails, create the database manually via: CREATE DATABASE ${targetDb};\n`);
        } finally {
          await maintenanceClient.end();
        }
      } else {
        throw probeErr;
      }
    }
  } catch (err: any) {
    deployLogger.warn('Database pre-check note', { message: err.message });
  }
}

export async function deployInit(): Promise<void> {
  console.log('🚀 Starting Deployment Database Initialization...\n');

  try {
    // Step 0: Ensure target database catalog exists
    await ensureDatabaseExists();

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
