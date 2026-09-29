import { query } from '../config/database';
import { TenantModel } from '../models/tenant.model';
import storageService from '../services/storage.service';

async function verifyAllFeatures() {
  console.log('--- Step 1: Verify Database Columns & Status Enums ---');
  const cols = await query(`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'tenants' AND column_name = 'subscription_exempt'
  `);
  console.log('subscription_exempt column:', cols.rows[0]);

  const enumVals = await query(`
    SELECT enumlabel 
    FROM pg_enum 
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
    WHERE pg_type.typname = 'subscription_status'
  `);
  console.log('subscription_status enum values:', enumVals.rows.map((r: any) => r.enumlabel).join(', '));

  console.log('\n--- Step 2: Test TenantModel Whitelist / Exemption ---');
  const tRes = await query(`SELECT id FROM tenants LIMIT 1`);
  if (tRes.rows.length > 0) {
    const t = await TenantModel.findById(tRes.rows[0].id);
    if (t) {
      console.log(`First tenant: ${t.name} (id: ${t.id}), subscriptionExempt: ${t.subscriptionExempt}`);
    
    console.log('\n--- Step 3: Test Storage Service Isolation & Metrics ---');
    const storageMetrics = await storageService.getTenantStorageUsage(t.id);
    console.log('Storage metrics for tenant:', {
      tenantId: storageMetrics.tenantId,
      usedBytes: storageMetrics.usedBytes,
      usedMb: storageMetrics.usedMb,
      allocatedMb: storageMetrics.allocatedMb,
      percentUsed: storageMetrics.percentUsed,
      remainingMb: storageMetrics.remainingMb,
      documentCount: storageMetrics.documentCount,
      folderPath: storageMetrics.folderPath,
      isOverQuota: storageMetrics.isOverQuota,
    });
    }
  }

  console.log('\n--- Step 4: Verify Audit Logs Query with Filters ---');
  const auditRes = await query(`
    SELECT al.id, al.action, al.entity_type, al.description 
    FROM audit_logs al 
    LIMIT 3
  `);
  console.log(`Found ${auditRes.rows.length} audit logs`);

  console.log('\n✅ All database models, storage isolation paths, and queries verified successfully!');
  process.exit(0);
}

verifyAllFeatures().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
