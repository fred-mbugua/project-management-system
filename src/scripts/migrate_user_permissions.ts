// ══════════════════════════════════════════════════════════════════════
// Migration: User Permissions & Project-Level Scoping
// Adds project_scope and permissions JSONB to users table
// ══════════════════════════════════════════════════════════════════════

import { query } from '../config/database';
import logger from '../utils/logger';

const migrateLogger = logger.child('MigrateUserPermissions');

export async function runMigration() {
  migrateLogger.info('🚀 Running migration: User Permissions & Project Scope...');

  try {
    // 1. Add project_scope column (ALL vs ASSIGNED)
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS project_scope VARCHAR(20) NOT NULL DEFAULT 'ALL';
    `);
    migrateLogger.info('✅ Added project_scope column to users table');

    // 2. Add permissions JSONB column
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL;
    `);
    migrateLogger.info('✅ Added permissions JSONB column to users table');

    // 3. Create indexes for quick user lookup and project membership
    await query(`
      CREATE INDEX IF NOT EXISTS idx_users_project_scope ON users(project_scope);
      CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_project_members_project ON project_members(project_id);
    `);
    migrateLogger.info('✅ Created indexes on users and project_members');

    // 4. Set project_scope = 'ASSIGNED' for existing TEAM_MEMBER and CLIENT_PORTAL users if not explicitly set
    await query(`
      UPDATE users 
      SET project_scope = 'ASSIGNED' 
      WHERE role IN ('TEAM_MEMBER', 'CLIENT_PORTAL') AND project_scope = 'ALL';
    `);
    migrateLogger.info('✅ Updated default project_scope for team members');

    migrateLogger.info('🎉 User Permissions migration completed successfully!');
  } catch (err: any) {
    migrateLogger.error('❌ Migration failed:', { error: err.message });
    throw err;
  }
}

if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default runMigration;
