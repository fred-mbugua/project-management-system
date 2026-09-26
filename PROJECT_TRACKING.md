# PROJECT_TRACKING.md: SaaS Project Management & ERP Development State

## 1. System Metadata & Technical Stack
- **Application**: Multi-Tenant Project Management, Invoicing & ERP System
- **Stack**: Node.js, TypeScript, Express.js, PostgreSQL, EJS, Modular CSS/JS
- **Integrations**: Safaricom Daraja (C2B, B2C, STK), Africa's Talking / Twilio, Nodemailer, BullMQ/Redis
- **Current Milestone**: Phase 1 - Scaffolding & Core Architecture

---

## 2. Implementation Roadmap

### Phase 1: Foundation, Multi-Tenancy & Database Architecture
- [ ] Initialize TypeScript, ESLint, Prettier, and directory structure.
- [ ] Configure PostgreSQL database connection pool and migration tool.
- [ ] Design comprehensive database schema:
  - `tenants`, `users`, `roles`, `tenant_configs` (tax, M-Pesa, branding)
  - `projects`, `project_members`, `maintenance_contracts`
  - `quotations`, `invoices`, `invoice_items`, `payment_records`
  - `expenses`, `expense_categories`, `audit_logs`
- [ ] Setup `express-session` with secure Redis or PostgreSQL session storage.
- [ ] Build global error handling middleware and tenant extraction middleware.
- [ ] Create base layout templates (`main.ejs`, `auth.ejs`) and core CSS design system.

### Phase 2: Authentication, Tenant Onboarding & Admin Suite
- [ ] Implement Tenant Registration with company data, logo upload, and PIN.
- [ ] User authentication with Argon2 password hashing and role assignment.
- [ ] Super Admin Dashboard:
  - Tenant subscription tiers and pricing plans.
  - Platform-level M-Pesa Daraja STK Push integration for plan renewals.
  - Platform metrics (Total Tenants, System Revenue, Active Users).
- [ ] Tenant Settings Dashboard:
  - Company branding (logo, colors, invoice note, terms).
  - Tax configurations (VAT, Withholding, Zero-rated).
  - Custom Daraja API credentials entry (encrypted at rest).

### Phase 3: Project Management, Team Hub & Maintenance Engine
- [ ] Project CRUD with client linking, budget, timeline, and status tracker.
- [ ] Team Management module:
  - Member profiles, roles, contact cards, payout credentials.
  - Assign members to projects with rate cards (fixed/hourly).
- [ ] Maintenance Contract Engine:
  - Recurring service setup (frequency, charge per interval, next visit).
  - Automated worker to flag due maintenance and notify clients.
- [ ] Interactive Calendar view (FullCalendar or custom server-driven UI) showing tasks, maintenance visits, and payment schedules.

### Phase 4: Quotation & Multi-Template Invoice Engine
- [ ] Quotation builder with dynamic row calculation and status workflow (`DRAFT`, `SENT`, `ACCEPTED`, `DECLINED`).
- [ ] One-click quote-to-invoice transformation pipeline.
- [ ] Invoice Engine with multiple design templates:
  - Modern Minimalist, Corporate Slate, Classic Bordered.
  - Dynamic injection of tenant logos, color schemes, and payment instructions.
- [ ] Automated tax calculations displaying breakdown per KRA guidelines.
- [ ] Headless PDF rendering service for quotes and invoices.

### Phase 5: Payment Processing (M-Pesa C2B / B2C) & Expenses
- [ ] Tenant Daraja STK Push initiation endpoint for invoices.
- [ ] Webhook callback handlers for M-Pesa validation and confirmation.
- [ ] Payment reconciliation service:
  - Partial payments, balance remaining, automated invoice status updating (`PAID`, `PARTIAL`, `OVERDUE`).
- [ ] Contractor/Team B2C disbursement module:
  - Balance verification, B2C payment execution, transaction reference storage.
- [ ] Expense Tracker:
  - Log expenses against specific projects or overhead.
  - Receipt image uploads and categorization.

### Phase 6: Automated Notifications, Reports & Data Import/Export
- [ ] BullMQ background scheduler:
  - Automated invoice reminders (3 days before due, on due date, overdue).
  - SMS & Email notification dispatchers.
- [ ] Real-time Financial Reporting:
  - Profit & Loss (P&L) statements per project and company-wide.
  - Tax summary report (Sales VAT vs. Input VAT).
- [ ] Import/Export pipelines:
  - CSV/Excel export for transactions, invoices, and debtor lists.
  - Bulk import for client contacts and expenses.

---

## 3. Architecture & Strict Boundary Rules
1. **Zero Inline Styles/Scripts**: EJS templates must only contain semantic HTML and layout slots. Include styles via `<link rel="stylesheet" href="/css/...">` and scripts via `<script src="/js/..."></script>`.
2. **Tenant Data Isolation**: Every SQL query must contain `WHERE tenant_id = :tenantId`. Reject any financial transaction query lacking a valid tenant context.
3. **M-Pesa Webhook Idempotency**: Store all incoming `TransID` values in a `payment_transactions` table with unique constraints to prevent duplicate ledger credits.
4. **Mobile Usability**: All dashboard components must collapse cleanly into a responsive off-canvas drawer navigation for mobile screens.

---

## 4. Current State & Immediate Next Task
- **Active Task**: Step 1 - Project initialization, TypeScript setup, database schema definition, and directory scaffolding.
- **Blockers**: None.

---

## 5. Step-by-Step Execution Plan
1. Setup Project & Schema
   └── Initialize TS, Express, PostgreSQL schema with tenant isolation

2. Build Auth, Onboarding & Settings
   └── Multi-tenant registration, RBAC, tenant branding & M-Pesa credentials

3. Implement Projects, Team & Maintenance
   └── Project tracking, team contact registry, recurring maintenance cron

4. Build Quotations & Invoicing
   └── Multi-template dynamic EJS renders, PDF generation, KRA tax calculations

5. Integrate M-Pesa (C2B & B2C) & Expenses
   └── STK push for invoice payment, B2C for team payouts, expense tracking

6. Automation & Analytics
   └── Scheduled SMS/email reminders, P&L reporting, CSV/Excel import-export

---

## 6. Completion Log
| Phase | Status | Date Started | Date Completed | Notes |
|-------|--------|-------------|----------------|-------|
| Phase 1 | ✅ Completed | 2026-09-16 | 2026-09-26 | Foundation, DB schema, complete UI/UX & mobile design overhaul (27 views, zero inline styles/scripts, 44px touch targets) |
| Phase 2 | 🔄 In Progress | 2026-09-26 | - | Auth & Admin |
| Phase 3 | ⏳ Pending | - | - | Projects & Team |
| Phase 4 | ⏳ Pending | - | - | Quotations & Invoicing |
| Phase 5 | ⏳ Pending | - | - | M-Pesa & Expenses |
| Phase 6 | ⏳ Pending | - | - | Notifications & Reports |

