// ══════════════════════════════════════════════════════════════════════
// Database Clean Script - Production Deployment Preparation
// Cleans all demo/test data, tenants, users, projects, invoices & logs
// Preserves & seeds baseline Subscription Plans and Super Admin account
// ══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool, query } from '../config/database';
import { SubscriptionModel, UserModel, SubscriptionTier, UserRole } from '../models';
import logger from '../utils/logger';

const cleanLogger = logger.child('CleanDatabase');

export async function cleanDatabase(closePool: boolean = true): Promise<void> {
  console.log('\n🧹 ─────────────────────────────────────────────────────────────');
  console.log('   PM & ERP SaaS - Database Production Cleaning');
  console.log('─────────────────────────────────────────────────────────────\n');

  try {
    // 1. Truncate all transactional & tenant-specific data
    console.log('🗑️  Purging demo & test data across all tables...');
    await query(`
      TRUNCATE TABLE
        user_sessions,
        error_logs,
        audit_logs,
        quotation_items,
        quotations,
        invoice_items,
        payments,
        invoices,
        expenses,
        team_payouts,
        maintenance_schedules,
        project_documents,
        tasks,
        project_members,
        projects,
        clients,
        tenant_subscriptions,
        subscription_invoices,
        users,
        tenants
      CASCADE;
    `);
    console.log('   ✅ All tenant and transactional tables truncated successfully.\n');

    // 2. Ensure system Subscription Plans exist
    console.log('📋 Initializing platform Subscription Plans...');
    const plans = [
      {
        id: 'plan-starter',
        name: 'Starter',
        tier: SubscriptionTier.STARTER,
        monthlyPrice: 1500,
        annualPrice: 15000,
        price: 1500,
        frequency: 'MONTHLY',
        intervalMonths: 1,
        description: 'Perfect for small consultancies and freelancers.',
        maxUsers: 5,
        maxProjects: 10,
        maxStorageMb: 500,
        features: { invoicing: true, mpesa: true, reports: false, maintenance: false },
        isActive: true,
      },
      {
        id: 'plan-professional',
        name: 'Professional',
        tier: SubscriptionTier.PROFESSIONAL,
        monthlyPrice: 4500,
        annualPrice: 45000,
        price: 4500,
        frequency: 'MONTHLY',
        intervalMonths: 1,
        description: 'For growing businesses requiring full ERP & M-Pesa automation.',
        maxUsers: 25,
        maxProjects: 50,
        maxStorageMb: 2000,
        features: { invoicing: true, mpesa: true, reports: true, maintenance: true, b2c: true },
        isActive: true,
      },
      {
        id: 'plan-enterprise',
        name: 'Enterprise',
        tier: SubscriptionTier.ENTERPRISE,
        monthlyPrice: 12000,
        annualPrice: 120000,
        price: 12000,
        frequency: 'MONTHLY',
        intervalMonths: 1,
        description: 'Comprehensive enterprise scale with whitelabeling & custom domains.',
        maxUsers: 100,
        maxProjects: 500,
        maxStorageMb: 10000,
        features: {
          invoicing: true,
          mpesa: true,
          reports: true,
          maintenance: true,
          b2c: true,
          api: true,
          whitelabel: true,
        },
        isActive: true,
      },
    ];

    for (const plan of plans) {
      await SubscriptionModel.upsertPlan(plan);
      console.log(`   ✅ Plan: ${plan.name} (${plan.tier}) - KES ${plan.monthlyPrice.toLocaleString()}/mo`);
    }

    // 3. Create clean Super Admin
    console.log('\n👑 Ensuring Super Admin account...');
    const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@pmerp.local';
    const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'Password123!';
    const passwordHash = await bcrypt.hash(superAdminPassword, 12);

    const superAdmin = await UserModel.upsert({
      email: superAdminEmail,
      passwordHash: passwordHash,
      firstName: process.env.SUPER_ADMIN_FIRST_NAME || 'System',
      lastName: process.env.SUPER_ADMIN_LAST_NAME || 'Admin',
      phone: process.env.SUPER_ADMIN_PHONE || '+254700000000',
      role: UserRole.SUPER_ADMIN,
      tenantId: null,
    });

    console.log(`   ✅ Super Admin: ${superAdmin.email} (Role: ${superAdmin.role})`);
    if (!process.env.SUPER_ADMIN_PASSWORD) {
      console.log(`   ℹ️  Default password: Password123! (Set SUPER_ADMIN_PASSWORD in production .env)`);
    }

    // 4. Clean local uploads folder (keep .gitkeep)
    const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      cleanUploadsDirectory(uploadsDir);
      console.log('\n📁 Cleaned public/uploads directory (preserved directory structure and .gitkeep).');
    }

    // 5. Verification: Count records per table
    console.log('\n📊 Database State Summary After Cleaning:');
    console.log('─────────────────────────────────────────────────────────────');
    const tables = [
      'subscription_plans',
      'users',
      'tenants',
      'tenant_subscriptions',
      'subscription_invoices',
      'clients',
      'projects',
      'project_members',
      'tasks',
      'quotations',
      'quotation_items',
      'invoices',
      'invoice_items',
      'payments',
      'expenses',
      'team_payouts',
      'maintenance_schedules',
      'project_documents',
      'audit_logs',
      'error_logs',
      'user_sessions',
    ];

    for (const table of tables) {
      const res = await query(`SELECT count(*) FROM ${table}`);
      const count = parseInt(res.rows[0].count, 10);
      const icon = count === 0 ? '⚪' : '🟢';
      console.log(`   ${icon} ${table.padEnd(25)}: ${count} record(s)`);
    }
    console.log('─────────────────────────────────────────────────────────────');
    console.log('🚀 Database is clean and ready for deployment!\n');
  } catch (error: any) {
    cleanLogger.error('❌ Database clean failed', { error: error.message });
    console.error('❌ Database clean failed:', error);
    throw error;
  } finally {
    if (closePool) {
      await pool.end();
    }
  }
}

function cleanUploadsDirectory(dirPath: string): void {
  const items = fs.readdirSync(dirPath);
  for (const item of items) {
    if (item === '.gitkeep') continue;
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      cleanUploadsDirectory(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }
}

if (require.main === module) {
  cleanDatabase(true)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default cleanDatabase;
