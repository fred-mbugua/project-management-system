// ══════════════════════════════════════════════════════════════════════
// Database Migration Runner - Raw PostgreSQL
// Reads src/models/schema.sql and applies it to the database
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { query, pool } from '../config/database';
import logger from '../utils/logger';

const migrateLogger = logger.child('Migrate');

async function runMigration(): Promise<void> {
  const schemaPath = path.join(__dirname, '..', 'models', 'schema.sql');
  migrateLogger.info('Starting database migration...', { schemaPath });

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await query(sql);
    migrateLogger.info('✅ Database schema applied successfully!');
  } catch (error: any) {
    migrateLogger.error('❌ Migration failed', { error: error.message });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigration();
}

export default runMigration;
