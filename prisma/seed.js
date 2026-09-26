"use strict";
// ══════════════════════════════════════════════════════════════════════
// Database Seed Script
// Creates demo data: Super Admin, Subscription Plans, Tenant, Users,
// Clients, Projects, Tasks, Quotations, Invoices, Payments, Expenses
// ══════════════════════════════════════════════════════════════════════
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Seeding database...\n');
    // ──────────────────────────────────────────────
    // 1. Subscription Plans
    // ──────────────────────────────────────────────
    console.log('📋 Creating subscription plans...');
    const starterPlan = await prisma.subscriptionPlan.upsert({
        where: { id: 'plan-starter' },
        update: {},
        create: {
            id: 'plan-starter',
            name: 'Starter',
            tier: 'STARTER',
            monthlyPrice: 1500,
            annualPrice: 15000,
            maxUsers: 5,
            maxProjects: 10,
            maxStorageMb: 500,
            features: { invoicing: true, mpesa: true, reports: false, maintenance: false },
        },
    });
    const proPlan = await prisma.subscriptionPlan.upsert({
        where: { id: 'plan-professional' },
        update: {},
        create: {
            id: 'plan-professional',
            name: 'Professional',
            tier: 'PROFESSIONAL',
            monthlyPrice: 4500,
            annualPrice: 45000,
            maxUsers: 25,
            maxProjects: 50,
            maxStorageMb: 2000,
            features: { invoicing: true, mpesa: true, reports: true, maintenance: true, b2c: true },
        },
    });
    await prisma.subscriptionPlan.upsert({
        where: { id: 'plan-enterprise' },
        update: {},
        create: {
            id: 'plan-enterprise',
            name: 'Enterprise',
            tier: 'ENTERPRISE',
            monthlyPrice: 12000,
            annualPrice: 120000,
            maxUsers: 100,
            maxProjects: 500,
            maxStorageMb: 10000,
            features: { invoicing: true, mpesa: true, reports: true, maintenance: true, b2c: true, api: true, whitelabel: true },
        },
    });
    console.log('  ✅ Plans: Starter, Professional, Enterprise\n');
    // ──────────────────────────────────────────────
    // 2. Super Admin (Platform Owner)
    // ──────────────────────────────────────────────
    console.log('👑 Creating Super Admin...');
    const superAdminPassword = await bcryptjs_1.default.hash('Password123!', 12);
    await prisma.user.upsert({
        where: { email: 'admin@pmerp.local' },
        update: {},
        create: {
            email: 'admin@pmerp.local',
            passwordHash: superAdminPassword,
            firstName: 'System',
            lastName: 'Admin',
            role: 'SUPER_ADMIN',
            phone: '+254700000000',
            tenantId: null,
        },
    });
    console.log('  ✅ admin@pmerp.local / Password123!\n');
    // ──────────────────────────────────────────────
    // 3. Demo Tenant: Acme Engineering Ltd
    // ──────────────────────────────────────────────
    console.log('🏢 Creating demo tenant: Acme Engineering Ltd...');
    const tenant = await prisma.tenant.upsert({
        where: { slug: 'acme-engineering' },
        update: {},
        create: {
            name: 'Acme Engineering Ltd',
            slug: 'acme-engineering',
            email: 'info@acme.co.ke',
            phone: '+254720123456',
            address: 'Westlands Business Park, 3rd Floor',
            city: 'Nairobi',
            country: 'Kenya',
            kraPin: 'P051234567X',
            vatRegistered: true,
            defaultTaxType: 'VAT_16',
            primaryColor: '#4F46E5',
            secondaryColor: '#1E293B',
            accentColor: '#06B6D4',
            invoicePrefix: 'INV',
            quotePrefix: 'QUO',
            invoiceNotes: 'Payment is due within the terms specified above. Late payments may attract a 2% monthly surcharge.',
            paymentTerms: 'Net 30',
            bankDetails: 'Equity Bank | A/C: 1234567890 | Branch: Westlands',
            darajaShortcode: '174379',
            darajaShortcodeType: 'PAYBILL',
            darajaEnvironment: 'sandbox',
        },
    });
    // Subscription
    await prisma.tenantSubscription.upsert({
        where: { tenantId: tenant.id },
        update: {},
        create: {
            tenantId: tenant.id,
            planId: proPlan.id,
            status: 'ACTIVE',
            billingCycle: 'monthly',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
    });
    console.log('  ✅ Acme Engineering Ltd (Professional Plan)\n');
    // ──────────────────────────────────────────────
    // 4. Tenant Users (All 5 roles)
    // ──────────────────────────────────────────────
    console.log('👥 Creating tenant users...');
    const userPassword = await bcryptjs_1.default.hash('Password123!', 12);
    const owner = await prisma.user.upsert({
        where: { email: 'owner@acme.co.ke' },
        update: {},
        create: {
            tenantId: tenant.id,
            email: 'owner@acme.co.ke',
            passwordHash: userPassword,
            firstName: 'James',
            lastName: 'Kariuki',
            phone: '+254720111222',
            nationalId: '12345678',
            role: 'TENANT_OWNER',
            mpesaNumber: '254720111222',
        },
    });
    const pm = await prisma.user.upsert({
        where: { email: 'pm@acme.co.ke' },
        update: {},
        create: {
            tenantId: tenant.id,
            email: 'pm@acme.co.ke',
            passwordHash: userPassword,
            firstName: 'Grace',
            lastName: 'Wanjiru',
            phone: '+254721333444',
            role: 'PROJECT_MANAGER',
            hourlyRate: 3500,
        },
    });
    const accountant = await prisma.user.upsert({
        where: { email: 'accounts@acme.co.ke' },
        update: {},
        create: {
            tenantId: tenant.id,
            email: 'accounts@acme.co.ke',
            passwordHash: userPassword,
            firstName: 'Peter',
            lastName: 'Ochieng',
            phone: '+254722555666',
            role: 'ACCOUNTANT',
        },
    });
    const teamMember = await prisma.user.upsert({
        where: { email: 'tech@acme.co.ke' },
        update: {},
        create: {
            tenantId: tenant.id,
            email: 'tech@acme.co.ke',
            passwordHash: userPassword,
            firstName: 'David',
            lastName: 'Mwangi',
            phone: '+254723777888',
            role: 'TEAM_MEMBER',
            mpesaNumber: '254723777888',
            hourlyRate: 1500,
        },
    });
    const clientPortal = await prisma.user.upsert({
        where: { email: 'client@safaricom.co.ke' },
        update: {},
        create: {
            tenantId: tenant.id,
            email: 'client@safaricom.co.ke',
            passwordHash: userPassword,
            firstName: 'Mary',
            lastName: 'Njeri',
            phone: '+254724999000',
            role: 'CLIENT_PORTAL',
        },
    });
    console.log('  ✅ owner@acme.co.ke (TENANT_OWNER)');
    console.log('  ✅ pm@acme.co.ke (PROJECT_MANAGER)');
    console.log('  ✅ accounts@acme.co.ke (ACCOUNTANT)');
    console.log('  ✅ tech@acme.co.ke (TEAM_MEMBER)');
    console.log('  ✅ client@safaricom.co.ke (CLIENT_PORTAL)');
    console.log('  📝 All passwords: Password123!\n');
    // ──────────────────────────────────────────────
    // 5. Clients
    // ──────────────────────────────────────────────
    console.log('🤝 Creating clients...');
    const client1 = await prisma.client.upsert({
        where: { id: 'client-safaricom' },
        update: {},
        create: {
            id: 'client-safaricom',
            tenantId: tenant.id,
            name: 'Safaricom PLC',
            contactPerson: 'Mary Njeri',
            email: 'procurement@safaricom.co.ke',
            phone: '+254722000001',
            address: 'Safaricom House, Waiyaki Way',
            city: 'Nairobi',
            kraPin: 'P000111222Z',
        },
    });
    const client2 = await prisma.client.upsert({
        where: { id: 'client-kplc' },
        update: {},
        create: {
            id: 'client-kplc',
            tenantId: tenant.id,
            name: 'Kenya Power & Lighting Co',
            contactPerson: 'John Otieno',
            email: 'projects@kplc.co.ke',
            phone: '+254722000002',
            address: 'Stima Plaza, Kolobot Road',
            city: 'Nairobi',
            kraPin: 'P000333444Y',
        },
    });
    const client3 = await prisma.client.upsert({
        where: { id: 'client-equity' },
        update: {},
        create: {
            id: 'client-equity',
            tenantId: tenant.id,
            name: 'Equity Bank Kenya',
            contactPerson: 'Alice Muthoni',
            email: 'facilities@equitybank.co.ke',
            phone: '+254722000003',
            address: 'Equity Centre, Hospital Road',
            city: 'Nairobi',
            kraPin: 'P000555666X',
        },
    });
    console.log('  ✅ Safaricom PLC, Kenya Power, Equity Bank\n');
    // ──────────────────────────────────────────────
    // 6. Projects
    // ──────────────────────────────────────────────
    console.log('📁 Creating projects...');
    const project1 = await prisma.project.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: 'PRJ-001' } },
        update: {},
        create: {
            tenantId: tenant.id,
            clientId: client1.id,
            name: 'Safaricom HQ Network Upgrade',
            code: 'PRJ-001',
            description: 'Complete overhaul of the enterprise network infrastructure at Safaricom headquarters. Includes fiber optic cabling, switch replacements, and firewall upgrades.',
            status: 'IN_PROGRESS',
            budget: 2500000,
            startDate: new Date('2026-07-01'),
            endDate: new Date('2026-12-31'),
        },
    });
    const project2 = await prisma.project.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: 'PRJ-002' } },
        update: {},
        create: {
            tenantId: tenant.id,
            clientId: client2.id,
            name: 'KPLC Substation Maintenance',
            code: 'PRJ-002',
            description: 'Annual preventive maintenance contract for 12 substations across Nairobi metropolitan area.',
            status: 'IN_PROGRESS',
            budget: 4800000,
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-12-31'),
        },
    });
    const project3 = await prisma.project.upsert({
        where: { tenantId_code: { tenantId: tenant.id, code: 'PRJ-003' } },
        update: {},
        create: {
            tenantId: tenant.id,
            clientId: client3.id,
            name: 'Equity Bank Branch Security Install',
            code: 'PRJ-003',
            description: 'CCTV and access control system installation for 5 new branches in Western Kenya.',
            status: 'PLANNING',
            budget: 1800000,
            startDate: new Date('2026-10-01'),
            endDate: new Date('2027-03-31'),
        },
    });
    console.log('  ✅ 3 projects created\n');
    // ──────────────────────────────────────────────
    // 7. Tasks
    // ──────────────────────────────────────────────
    console.log('📋 Creating tasks...');
    await prisma.task.createMany({
        data: [
            {
                tenantId: tenant.id,
                projectId: project1.id,
                assignedToId: pm.id,
                title: 'Site survey and network audit',
                status: 'COMPLETED',
                priority: 'HIGH',
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
                status: 'IN_PROGRESS',
                priority: 'HIGH',
                estimatedHours: 40,
                dueDate: new Date('2026-10-15'),
            },
            {
                tenantId: tenant.id,
                projectId: project1.id,
                assignedToId: teamMember.id,
                title: 'Configure firewall rules',
                status: 'TODO',
                priority: 'MEDIUM',
                estimatedHours: 8,
                dueDate: new Date('2026-11-01'),
            },
            {
                tenantId: tenant.id,
                projectId: project2.id,
                assignedToId: pm.id,
                title: 'Q3 substation inspections',
                status: 'IN_PROGRESS',
                priority: 'URGENT',
                estimatedHours: 60,
                dueDate: new Date('2026-09-30'),
            },
            {
                tenantId: tenant.id,
                projectId: project3.id,
                title: 'Procurement of CCTV equipment',
                status: 'TODO',
                priority: 'MEDIUM',
                estimatedHours: 10,
                dueDate: new Date('2026-10-15'),
            },
        ],
        skipDuplicates: true,
    });
    console.log('  ✅ 5 tasks created\n');
    // ──────────────────────────────────────────────
    // 8. Quotation
    // ──────────────────────────────────────────────
    console.log('📝 Creating quotation...');
    const quotation = await prisma.quotation.create({
        data: {
            tenantId: tenant.id,
            clientId: client3.id,
            projectId: project3.id,
            quotationNumber: 'QUO-2026-0001',
            title: 'Equity Bank Branch Security Systems',
            status: 'APPROVED',
            issueDate: new Date('2026-08-15'),
            validUntil: new Date('2026-09-15'),
            subtotal: 1650000,
            taxAmount: 264000,
            discountAmount: 0,
            totalAmount: 1914000,
            notes: 'Installation includes 1-year warranty on all equipment.',
            terms: 'Payment: 50% upfront, 50% on completion.',
            items: {
                create: [
                    {
                        description: 'Hikvision IP Camera System (8-channel)',
                        quantity: 5,
                        unitPrice: 185000,
                        taxType: 'VAT_16',
                        taxRate: 16,
                        lineTotal: 925000,
                        lineTax: 148000,
                        sortOrder: 1,
                    },
                    {
                        description: 'Access Control System (Door Locks + Biometric)',
                        quantity: 5,
                        unitPrice: 95000,
                        taxType: 'VAT_16',
                        taxRate: 16,
                        lineTotal: 475000,
                        lineTax: 76000,
                        sortOrder: 2,
                    },
                    {
                        description: 'Installation & Configuration Labour',
                        quantity: 1,
                        unitPrice: 250000,
                        taxType: 'VAT_16',
                        taxRate: 16,
                        lineTotal: 250000,
                        lineTax: 40000,
                        sortOrder: 3,
                    },
                ],
            },
        },
    });
    console.log('  ✅ QUO-2026-0001 (Approved)\n');
    // ──────────────────────────────────────────────
    // 9. Invoices
    // ──────────────────────────────────────────────
    console.log('💰 Creating invoices...');
    const invoice1 = await prisma.invoice.create({
        data: {
            tenantId: tenant.id,
            clientId: client1.id,
            projectId: project1.id,
            invoiceNumber: 'INV-2026-0001',
            title: 'Network Upgrade Phase 1 - Site Survey & Materials',
            status: 'PAID',
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
            notes: 'Payment received in full. Thank you.',
            items: {
                create: [
                    {
                        description: 'Cisco Catalyst 9300 Switches (24-port)',
                        quantity: 8,
                        unitPrice: 75000,
                        taxType: 'VAT_16',
                        taxRate: 16,
                        lineTotal: 600000,
                        lineTax: 96000,
                        sortOrder: 1,
                    },
                    {
                        description: 'Network Survey & Design Consultancy',
                        quantity: 1,
                        unitPrice: 250000,
                        taxType: 'VAT_16',
                        taxRate: 16,
                        lineTotal: 250000,
                        lineTax: 40000,
                        sortOrder: 2,
                    },
                ],
            },
        },
    });
    const invoice2 = await prisma.invoice.create({
        data: {
            tenantId: tenant.id,
            clientId: client2.id,
            projectId: project2.id,
            invoiceNumber: 'INV-2026-0002',
            title: 'KPLC Q3 Maintenance Services',
            status: 'SENT',
            issueDate: new Date('2026-09-01'),
            dueDate: new Date('2026-10-01'),
            subtotal: 1200000,
            taxAmount: 192000,
            totalAmount: 1392000,
            amountPaid: 0,
            balanceDue: 1392000,
            template: 'corporate',
            tenantKraPin: 'P051234567X',
            clientKraPin: 'P000333444Y',
            items: {
                create: [
                    {
                        description: 'Quarterly Preventive Maintenance - 12 Substations',
                        quantity: 1,
                        unitPrice: 1000000,
                        taxType: 'VAT_16',
                        taxRate: 16,
                        lineTotal: 1000000,
                        lineTax: 160000,
                        sortOrder: 1,
                    },
                    {
                        description: 'Replacement Parts & Consumables',
                        quantity: 1,
                        unitPrice: 200000,
                        taxType: 'VAT_16',
                        taxRate: 16,
                        lineTotal: 200000,
                        lineTax: 32000,
                        sortOrder: 2,
                    },
                ],
            },
        },
    });
    console.log('  ✅ INV-2026-0001 (PAID: KES 986,000)');
    console.log('  ✅ INV-2026-0002 (SENT: KES 1,392,000)\n');
    // ──────────────────────────────────────────────
    // 10. Payments
    // ──────────────────────────────────────────────
    console.log('💳 Creating payment records...');
    await prisma.payment.create({
        data: {
            tenantId: tenant.id,
            invoiceId: invoice1.id,
            amount: 986000,
            paymentMethod: 'MPESA_STK',
            status: 'COMPLETED',
            paymentDate: new Date('2026-08-20'),
            mpesaReceiptNumber: 'SFK2LKJXYZ',
            mpesaPhoneNumber: '254722000001',
            mpesaTransactionDate: '20260820143022',
            notes: 'Full payment received via STK Push',
        },
    });
    console.log('  ✅ Payment for INV-2026-0001 (M-Pesa STK)\n');
    // ──────────────────────────────────────────────
    // 11. Expenses
    // ──────────────────────────────────────────────
    console.log('💸 Creating expenses...');
    await prisma.expense.createMany({
        data: [
            {
                tenantId: tenant.id,
                projectId: project1.id,
                category: 'MATERIALS',
                description: 'CAT6A Ethernet Cables (500m rolls x 10)',
                amount: 125000,
                vatAmount: 20000,
                taxDeductible: true,
                billable: true,
                expenseDate: new Date('2026-08-05'),
                vendor: 'Nairobi IT Suppliers',
            },
            {
                tenantId: tenant.id,
                projectId: project1.id,
                category: 'TRANSPORT',
                description: 'Site transport and logistics',
                amount: 15000,
                vatAmount: 0,
                taxDeductible: true,
                billable: false,
                expenseDate: new Date('2026-08-10'),
            },
            {
                tenantId: tenant.id,
                projectId: project2.id,
                category: 'EQUIPMENT',
                description: 'Transformer oil testing kit',
                amount: 85000,
                vatAmount: 13600,
                taxDeductible: true,
                billable: true,
                expenseDate: new Date('2026-07-15'),
                vendor: 'East Africa Power Tools Ltd',
            },
            {
                tenantId: tenant.id,
                category: 'OFFICE',
                description: 'Monthly office rent - September 2026',
                amount: 65000,
                vatAmount: 0,
                taxDeductible: true,
                billable: false,
                expenseDate: new Date('2026-09-01'),
                vendor: 'Westlands Property Management',
            },
        ],
    });
    console.log('  ✅ 4 expenses created\n');
    // ──────────────────────────────────────────────
    // 12. Team Payout
    // ──────────────────────────────────────────────
    console.log('💰 Creating team payout...');
    await prisma.teamPayout.create({
        data: {
            tenantId: tenant.id,
            userId: teamMember.id,
            amount: 45000,
            payoutType: 'SALARY',
            paymentMethod: 'MPESA_B2C',
            status: 'COMPLETED',
            payoutDate: new Date('2026-08-31'),
            mpesaRecipientNumber: '254723777888',
            mpesaTransactionId: 'B2C_TX_001',
            description: 'August 2026 salary - David Mwangi',
        },
    });
    console.log('  ✅ Salary payout to David Mwangi\n');
    // ──────────────────────────────────────────────
    // 13. Maintenance Schedule
    // ──────────────────────────────────────────────
    console.log('🔧 Creating maintenance schedule...');
    await prisma.maintenanceSchedule.create({
        data: {
            tenantId: tenant.id,
            projectId: project2.id,
            clientId: client2.id,
            title: 'KPLC Quarterly Substation Inspection',
            description: 'Routine preventive maintenance including transformer oil testing, breaker servicing, and relay calibration.',
            frequency: 'QUARTERLY',
            status: 'ACTIVE',
            chargeAmount: 1200000,
            taxType: 'VAT_16',
            startDate: new Date('2026-01-01'),
            nextDueDate: new Date('2026-10-01'),
            lastCompletedDate: new Date('2026-07-01'),
            autoInvoice: true,
            notifyDaysBefore: 7,
        },
    });
    console.log('  ✅ KPLC Quarterly Inspection\n');
    // ──────────────────────────────────────────────
    // 14. Audit Log
    // ──────────────────────────────────────────────
    await prisma.auditLog.create({
        data: {
            tenantId: tenant.id,
            userId: owner.id,
            action: 'CREATE',
            entityType: 'Tenant',
            entityId: tenant.id,
            description: 'Tenant "Acme Engineering Ltd" created via seed script',
        },
    });
    console.log('════════════════════════════════════════════════════');
    console.log('  ✅ Database seeded successfully!');
    console.log('════════════════════════════════════════════════════');
    console.log('');
    console.log('  Login Credentials:');
    console.log('  ─────────────────────────────────────────────');
    console.log('  Super Admin:      admin@pmerp.local');
    console.log('  Tenant Owner:     owner@acme.co.ke');
    console.log('  Project Manager:  pm@acme.co.ke');
    console.log('  Accountant:       accounts@acme.co.ke');
    console.log('  Team Member:      tech@acme.co.ke');
    console.log('  Client Portal:    client@safaricom.co.ke');
    console.log('  ─────────────────────────────────────────────');
    console.log('  All passwords:    Password123!');
    console.log('');
}
main()
    .then(async () => {
    await prisma.$disconnect();
})
    .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=seed.js.map