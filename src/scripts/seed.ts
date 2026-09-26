// ══════════════════════════════════════════════════════════════════════
// Database Seed Script - Raw PostgreSQL
// Seeds initial system plans, Super Admin, demo tenant, and ERP records
// ══════════════════════════════════════════════════════════════════════

import bcrypt from 'bcryptjs';
import { pool, withTransaction, query } from '../config/database';
import {
  SubscriptionModel,
  TenantModel,
  UserModel,
  ClientModel,
  ProjectModel,
  TaskModel,
  QuotationModel,
  InvoiceModel,
  PaymentModel,
  ExpenseModel,
  AuditLogModel,
  UserRole,
  SubscriptionTier,
  SubscriptionStatus,
  TaxType,
  DarajaShortcodeType,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  QuotationStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  ExpenseCategory,
  AuditAction,
} from '../models';

async function seed(): Promise<void> {
  console.log('🌱 Seeding database via raw PostgreSQL queries...\n');

  try {
    // ──────────────────────────────────────────────
    // 1. Subscription Plans
    // ──────────────────────────────────────────────
    console.log('📋 Creating subscription plans...');

    const starterPlan = await SubscriptionModel.upsertPlan({
      id: 'plan-starter',
      name: 'Starter',
      tier: SubscriptionTier.STARTER,
      monthlyPrice: 1500,
      annualPrice: 15000,
      maxUsers: 5,
      maxProjects: 10,
      maxStorageMb: 500,
      features: { invoicing: true, mpesa: true, reports: false, maintenance: false },
    });

    const proPlan = await SubscriptionModel.upsertPlan({
      id: 'plan-professional',
      name: 'Professional',
      tier: SubscriptionTier.PROFESSIONAL,
      monthlyPrice: 4500,
      annualPrice: 45000,
      maxUsers: 25,
      maxProjects: 50,
      maxStorageMb: 2000,
      features: { invoicing: true, mpesa: true, reports: true, maintenance: true, b2c: true },
    });

    await SubscriptionModel.upsertPlan({
      id: 'plan-enterprise',
      name: 'Enterprise',
      tier: SubscriptionTier.ENTERPRISE,
      monthlyPrice: 12000,
      annualPrice: 120000,
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
    });

    console.log('  ✅ Plans: Starter, Professional, Enterprise\n');

    // ──────────────────────────────────────────────
    // 2. Super Admin (Platform Owner)
    // ──────────────────────────────────────────────
    console.log('👑 Creating Super Admin...');
    const superAdminPassword = await bcrypt.hash('Password123!', 12);

    await UserModel.upsert({
      email: 'admin@pmerp.local',
      passwordHash: superAdminPassword,
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.SUPER_ADMIN,
      phone: '+254700000000',
      tenantId: null,
    });

    console.log('  ✅ admin@pmerp.local / Password123!\n');

    // ──────────────────────────────────────────────
    // 3. Demo Tenant: Acme Engineering Ltd
    // ──────────────────────────────────────────────
    console.log('🏢 Creating demo tenant: Acme Engineering Ltd...');

    const tenant = await TenantModel.upsert({
      name: 'Acme Engineering Ltd',
      slug: 'acme-engineering',
      email: 'info@acme.co.ke',
      phone: '+254720123456',
      address: 'Westlands Business Park, 3rd Floor',
      city: 'Nairobi',
      country: 'Kenya',
      kraPin: 'P051234567X',
      vatRegistered: true,
      defaultTaxType: TaxType.VAT_16,
      primaryColor: '#4F46E5',
      secondaryColor: '#1E293B',
      accentColor: '#06B6D4',
      invoicePrefix: 'INV',
      quotePrefix: 'QUO',
      invoiceNotes:
        'Payment is due within the terms specified above. Late payments may attract a 2% monthly surcharge.',
      paymentTerms: 'Net 30',
      bankDetails: 'Equity Bank | A/C: 1234567890 | Branch: Westlands',
      darajaShortcode: '174379',
      darajaShortcodeType: DarajaShortcodeType.PAYBILL,
      darajaEnvironment: 'sandbox',
    });

    // Subscription
    await SubscriptionModel.upsertTenantSubscription({
      tenantId: tenant.id,
      planId: proPlan.id,
      status: SubscriptionStatus.ACTIVE,
      billingCycle: 'monthly',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    console.log('  ✅ Acme Engineering Ltd (Professional Plan)\n');

    // ──────────────────────────────────────────────
    // 4. Tenant Users (All 5 roles)
    // ──────────────────────────────────────────────
    console.log('👥 Creating tenant users...');
    const userPassword = await bcrypt.hash('Password123!', 12);

    const owner = await UserModel.upsert({
      tenantId: tenant.id,
      email: 'owner@acme.co.ke',
      passwordHash: userPassword,
      firstName: 'James',
      lastName: 'Kariuki',
      phone: '+254720111222',
      nationalId: '12345678',
      role: UserRole.TENANT_OWNER,
      mpesaNumber: '254720111222',
    });

    const pm = await UserModel.upsert({
      tenantId: tenant.id,
      email: 'pm@acme.co.ke',
      passwordHash: userPassword,
      firstName: 'Grace',
      lastName: 'Wanjiru',
      phone: '+254721333444',
      role: UserRole.PROJECT_MANAGER,
      hourlyRate: 3500,
    });

    await UserModel.upsert({
      tenantId: tenant.id,
      email: 'accounts@acme.co.ke',
      passwordHash: userPassword,
      firstName: 'Peter',
      lastName: 'Ochieng',
      phone: '+254722555666',
      role: UserRole.ACCOUNTANT,
    });

    const teamMember = await UserModel.upsert({
      tenantId: tenant.id,
      email: 'tech@acme.co.ke',
      passwordHash: userPassword,
      firstName: 'David',
      lastName: 'Mwangi',
      phone: '+254723777888',
      role: UserRole.TEAM_MEMBER,
      mpesaNumber: '254723777888',
      hourlyRate: 1500,
    });

    await UserModel.upsert({
      tenantId: tenant.id,
      email: 'client@safaricom.co.ke',
      passwordHash: userPassword,
      firstName: 'Mary',
      lastName: 'Njeri',
      phone: '+254724999000',
      role: UserRole.CLIENT_PORTAL,
    });

    console.log('  ✅ 5 tenant users created (Password123!)\n');

    // ──────────────────────────────────────────────
    // 5. Clients
    // ──────────────────────────────────────────────
    console.log('🤝 Creating clients...');

    const client1 = await ClientModel.upsert({
      id: 'client-safaricom',
      tenantId: tenant.id,
      name: 'Safaricom PLC',
      contactPerson: 'Mary Njeri',
      email: 'procurement@safaricom.co.ke',
      phone: '+254722000001',
      address: 'Safaricom House, Waiyaki Way',
      city: 'Nairobi',
      kraPin: 'P000111222Z',
    });

    const client2 = await ClientModel.upsert({
      id: 'client-kplc',
      tenantId: tenant.id,
      name: 'Kenya Power & Lighting Co',
      contactPerson: 'John Otieno',
      email: 'projects@kplc.co.ke',
      phone: '+254722000002',
      address: 'Stima Plaza, Kolobot Road',
      city: 'Nairobi',
      kraPin: 'P000333444Y',
    });

    const client3 = await ClientModel.upsert({
      id: 'client-equity',
      tenantId: tenant.id,
      name: 'Equity Bank Kenya',
      contactPerson: 'Alice Muthoni',
      email: 'facilities@equitybank.co.ke',
      phone: '+254722000003',
      address: 'Equity Centre, Hospital Road',
      city: 'Nairobi',
      kraPin: 'P000555666X',
    });

    console.log('  ✅ Safaricom PLC, Kenya Power, Equity Bank\n');

    // ──────────────────────────────────────────────
    // 6. Projects
    // ──────────────────────────────────────────────
    console.log('📁 Creating projects...');

    const project1 = await ProjectModel.upsert({
      tenantId: tenant.id,
      clientId: client1.id,
      name: 'Safaricom HQ Network Upgrade',
      code: 'PRJ-001',
      description:
        'Complete overhaul of the enterprise network infrastructure at Safaricom headquarters.',
      status: ProjectStatus.IN_PROGRESS,
      budget: 2500000,
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-12-31'),
    });

    const project2 = await ProjectModel.upsert({
      tenantId: tenant.id,
      clientId: client2.id,
      name: 'KPLC Substation Maintenance',
      code: 'PRJ-002',
      description:
        'Annual preventive maintenance contract for 12 substations across Nairobi metropolitan area.',
      status: ProjectStatus.IN_PROGRESS,
      budget: 4800000,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    });

    const project3 = await ProjectModel.upsert({
      tenantId: tenant.id,
      clientId: client3.id,
      name: 'Equity Bank Branch Security Install',
      code: 'PRJ-003',
      description:
        'CCTV and access control system installation for 5 new branches in Western Kenya.',
      status: ProjectStatus.PLANNING,
      budget: 1800000,
      startDate: new Date('2026-10-01'),
      endDate: new Date('2027-03-31'),
    });

    console.log('  ✅ 3 projects created\n');

    // ──────────────────────────────────────────────
    // 7. Tasks
    // ──────────────────────────────────────────────
    console.log('📋 Creating tasks...');

    await TaskModel.createMany([
      {
        tenantId: tenant.id,
        projectId: project1.id,
        assignedToId: pm.id,
        title: 'Site survey and network audit',
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.HIGH,
        estimatedHours: 16,
        actualHours: 14,
        dueDate: new Date('2026-07-15'),
        completedAt: new Date('2026-07-14'),
      },
      {
        tenantId: tenant.id,
        projectId: project1.id,
        assignedToId: teamMember.id,
        title: 'Install fiber optic backbone',
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.HIGH,
        estimatedHours: 40,
        dueDate: new Date('2026-10-15'),
      },
    ]);

    console.log('  ✅ Tasks created\n');

    // ──────────────────────────────────────────────
    // 8. Quotation & Invoice
    // ──────────────────────────────────────────────
    console.log('📝 Creating quotation and invoices...');

    await QuotationModel.create({
      tenantId: tenant.id,
      clientId: client3.id,
      projectId: project3.id,
      quotationNumber: 'QUO-2026-0001',
      title: 'Equity Bank Branch Security Systems',
      status: QuotationStatus.APPROVED,
      issueDate: new Date('2026-08-15'),
      validUntil: new Date('2026-09-15'),
      subtotal: 1650000,
      taxAmount: 264000,
      totalAmount: 1914000,
      items: [
        {
          description: 'Hikvision IP Camera System (8-channel)',
          quantity: 5,
          unitPrice: 185000,
          taxType: TaxType.VAT_16,
          taxRate: 16,
          lineTotal: 925000,
          lineTax: 148000,
          sortOrder: 1,
        },
      ],
    });

    const invoice1 = await InvoiceModel.create({
      tenantId: tenant.id,
      clientId: client1.id,
      projectId: project1.id,
      invoiceNumber: 'INV-2026-0001',
      title: 'Network Upgrade Phase 1 - Site Survey & Materials',
      status: InvoiceStatus.PAID,
      issueDate: new Date('2026-08-01'),
      dueDate: new Date('2026-08-31'),
      subtotal: 850000,
      taxAmount: 136000,
      totalAmount: 986000,
      amountPaid: 986000,
      balanceDue: 0,
      template: 'modern',
      tenantKraPin: 'P051234567X',
      clientKraPin: 'P000111222Z',
      items: [
        {
          description: 'Cisco Catalyst 9300 Switches (24-port)',
          quantity: 8,
          unitPrice: 75000,
          taxType: TaxType.VAT_16,
          taxRate: 16,
          lineTotal: 600000,
          lineTax: 96000,
          sortOrder: 1,
        },
      ],
    });

    console.log('  ✅ Quotation and invoices created\n');

    // ──────────────────────────────────────────────
    // 9. Payment
    // ──────────────────────────────────────────────
    console.log('💳 Creating payment record...');

    await PaymentModel.create({
      tenantId: tenant.id,
      invoiceId: invoice1.id,
      amount: 986000,
      paymentMethod: PaymentMethod.MPESA_STK,
      status: PaymentStatus.COMPLETED,
      paymentDate: new Date('2026-08-20'),
      mpesaReceiptNumber: 'SFK2LKJXYZ',
      mpesaPhoneNumber: '254722000001',
      notes: 'Full payment received via STK Push',
    });

    console.log('  ✅ Payment for INV-2026-0001 recorded\n');

    // ──────────────────────────────────────────────
    // 10. Expenses
    // ──────────────────────────────────────────────
    console.log('💸 Creating expenses...');

    await ExpenseModel.createMany([
      {
        tenantId: tenant.id,
        projectId: project1.id,
        category: ExpenseCategory.MATERIALS,
        description: 'CAT6A Ethernet Cables (500m rolls x 10)',
        amount: 125000,
        vatAmount: 20000,
        taxDeductible: true,
        billable: true,
        expenseDate: new Date('2026-08-05'),
        vendor: 'Nairobi IT Suppliers',
      },
    ]);

    console.log('  ✅ Expenses created\n');

    // ──────────────────────────────────────────────
    // 11. Audit Log
    // ──────────────────────────────────────────────
    await AuditLogModel.create({
      tenantId: tenant.id,
      userId: owner.id,
      action: AuditAction.CREATE,
      entityType: 'Tenant',
      entityId: tenant.id,
      description: 'Tenant "Acme Engineering Ltd" created via raw PSQL seed script',
    });

    console.log('════════════════════════════════════════════════════');
    console.log('  ✅ Raw PostgreSQL database seeded successfully!');
    console.log('════════════════════════════════════════════════════\n');
  } catch (err: any) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seed();
}

export default seed;
