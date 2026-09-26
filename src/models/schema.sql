-- ══════════════════════════════════════════════════════════════════════
-- PM & ERP SaaS - Raw PostgreSQL Database Schema (DDL)
-- Multi-Tenant Architecture with Strict Tenant Isolation & Indexing
-- ══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ──────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'SUPER_ADMIN',
    'TENANT_OWNER',
    'PROJECT_MANAGER',
    'ACCOUNTANT',
    'TEAM_MEMBER',
    'CLIENT_PORTAL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM (
    'PLANNING',
    'IN_PROGRESS',
    'ON_HOLD',
    'COMPLETED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM (
    'TODO',
    'IN_PROGRESS',
    'IN_REVIEW',
    'COMPLETED',
    'BLOCKED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE quotation_status AS ENUM (
    'DRAFT',
    'SENT',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
    'CONVERTED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM (
    'DRAFT',
    'SENT',
    'PARTIALLY_PAID',
    'PAID',
    'OVERDUE',
    'CANCELLED',
    'VOID'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'MPESA_STK',
    'MPESA_C2B',
    'MPESA_B2C',
    'BANK_TRANSFER',
    'CASH',
    'CHEQUE',
    'CARD'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED',
    'REVERSED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE tax_type AS ENUM (
    'VAT_16',
    'ZERO_RATED',
    'EXEMPT',
    'WITHHOLDING_3',
    'WITHHOLDING_5',
    'CUSTOM'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE expense_category AS ENUM (
    'MATERIALS',
    'LABOUR',
    'TRANSPORT',
    'EQUIPMENT',
    'SUBCONTRACTOR',
    'UTILITIES',
    'OFFICE',
    'MARKETING',
    'INSURANCE',
    'LICENSE_PERMITS',
    'MISCELLANEOUS'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE maintenance_frequency AS ENUM (
    'WEEKLY',
    'BIWEEKLY',
    'MONTHLY',
    'QUARTERLY',
    'BIANNUAL',
    'ANNUAL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE maintenance_status AS ENUM (
    'ACTIVE',
    'PAUSED',
    'COMPLETED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM (
    'STARTER',
    'PROFESSIONAL',
    'ENTERPRISE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM (
    'ACTIVE',
    'PAST_DUE',
    'CANCELLED',
    'TRIAL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE daraja_shortcode_type AS ENUM (
    'PAYBILL',
    'TILL'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payout_type AS ENUM (
    'SALARY',
    'WAGE',
    'EXPENSE_CLAIM',
    'BONUS',
    'COMMISSION'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE audit_action AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE',
    'LOGIN',
    'LOGOUT',
    'PAYMENT',
    'EXPORT',
    'IMPORT',
    'SETTINGS_CHANGE'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ──────────────────────────────────────────────
-- PLATFORM-LEVEL TABLES
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name VARCHAR(255) NOT NULL,
  tier subscription_tier NOT NULL,
  monthly_price NUMERIC(12, 2) NOT NULL,
  annual_price NUMERIC(12, 2) NOT NULL,
  max_users INT NOT NULL,
  max_projects INT NOT NULL,
  max_storage_mb INT NOT NULL DEFAULT 500,
  features JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────
-- TENANT & USER TABLES
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) NOT NULL DEFAULT 'Kenya',
  kra_pin VARCHAR(50),
  vat_registered BOOLEAN NOT NULL DEFAULT FALSE,
  default_tax_type tax_type NOT NULL DEFAULT 'VAT_16',
  logo_url TEXT,
  primary_color VARCHAR(50) NOT NULL DEFAULT '#4F46E5',
  secondary_color VARCHAR(50) NOT NULL DEFAULT '#1E293B',
  accent_color VARCHAR(50) NOT NULL DEFAULT '#06B6D4',
  invoice_prefix VARCHAR(20) NOT NULL DEFAULT 'INV',
  quote_prefix VARCHAR(20) NOT NULL DEFAULT 'QUO',
  invoice_notes TEXT,
  payment_terms VARCHAR(255),
  bank_details TEXT,
  daraja_consumer_key TEXT,
  daraja_consumer_secret TEXT,
  daraja_passkey TEXT,
  daraja_shortcode VARCHAR(50),
  daraja_shortcode_type daraja_shortcode_type NOT NULL DEFAULT 'PAYBILL',
  daraja_environment VARCHAR(50) NOT NULL DEFAULT 'sandbox',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id VARCHAR(64) NOT NULL REFERENCES subscription_plans(id),
  status subscription_status NOT NULL DEFAULT 'TRIAL',
  billing_cycle VARCHAR(50) NOT NULL DEFAULT 'monthly',
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
  mpesa_receipt_no VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(50),
  national_id VARCHAR(50),
  role user_role NOT NULL DEFAULT 'TEAM_MEMBER',
  mpesa_number VARCHAR(50),
  bank_name VARCHAR(100),
  bank_account VARCHAR(100),
  hourly_rate NUMERIC(10, 2),
  fixed_rate NUMERIC(12, 2),
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ──────────────────────────────────────────────
-- CLIENT TABLES
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) NOT NULL DEFAULT 'Kenya',
  kra_pin VARCHAR(50),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);

-- ──────────────────────────────────────────────
-- PROJECT & TASK TABLES
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id VARCHAR(64) REFERENCES clients(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(100) NOT NULL,
  description TEXT,
  status project_status NOT NULL DEFAULT 'PLANNING',
  budget NUMERIC(14, 2),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_projects_tenant_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);

CREATE TABLE IF NOT EXISTS project_members (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_project VARCHAR(100),
  rate_type VARCHAR(50) NOT NULL DEFAULT 'hourly',
  rate NUMERIC(10, 2),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_project_members UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id VARCHAR(64) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_to_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'TODO',
  priority task_priority NOT NULL DEFAULT 'MEDIUM',
  estimated_hours NUMERIC(8, 2),
  actual_hours NUMERIC(8, 2),
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

-- ──────────────────────────────────────────────
-- QUOTATIONS & INVOICES
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quotations (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id VARCHAR(64) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id VARCHAR(64) REFERENCES projects(id) ON DELETE SET NULL,
  quotation_number VARCHAR(100) NOT NULL,
  title VARCHAR(255),
  status quotation_status NOT NULL DEFAULT 'DRAFT',
  issue_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  converted_invoice_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_quotations_tenant_num UNIQUE (tenant_id, quotation_number)
);

CREATE INDEX IF NOT EXISTS idx_quotations_tenant ON quotations(tenant_id);

CREATE TABLE IF NOT EXISTS quotation_items (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  quotation_id VARCHAR(64) NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  tax_type tax_type NOT NULL DEFAULT 'VAT_16',
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 16,
  line_total NUMERIC(14, 2) NOT NULL,
  line_tax NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id VARCHAR(64) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id VARCHAR(64) REFERENCES projects(id) ON DELETE SET NULL,
  quotation_id VARCHAR(64),
  invoice_number VARCHAR(100) NOT NULL,
  title VARCHAR(255),
  status invoice_status NOT NULL DEFAULT 'DRAFT',
  issue_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date TIMESTAMPTZ NOT NULL,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  template VARCHAR(50) NOT NULL DEFAULT 'modern',
  etims_verification_hash TEXT,
  etims_qr_payload TEXT,
  tenant_kra_pin VARCHAR(50),
  client_kra_pin VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoices_tenant_num UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  tax_type tax_type NOT NULL DEFAULT 'VAT_16',
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 16,
  line_total NUMERIC(14, 2) NOT NULL,
  line_tax NUMERIC(14, 2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);

-- ──────────────────────────────────────────────
-- PAYMENTS & EXPENSES
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL,
  payment_method payment_method NOT NULL DEFAULT 'MPESA_STK',
  status payment_status NOT NULL DEFAULT 'PENDING',
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mpesa_receipt_number VARCHAR(100) UNIQUE,
  mpesa_phone_number VARCHAR(50),
  mpesa_transaction_date VARCHAR(50),
  mpesa_checkout_request_id VARCHAR(100),
  mpesa_merchant_request_id VARCHAR(100),
  reference_number VARCHAR(100),
  notes TEXT,
  raw_callback_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

CREATE TABLE IF NOT EXISTS expenses (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id VARCHAR(64) REFERENCES projects(id) ON DELETE SET NULL,
  category expense_category NOT NULL DEFAULT 'MISCELLANEOUS',
  description TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  vat_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  tax_deductible BOOLEAN NOT NULL DEFAULT FALSE,
  billable BOOLEAN NOT NULL DEFAULT FALSE,
  receipt_url TEXT,
  expense_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vendor VARCHAR(255),
  reference_no VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id);

CREATE TABLE IF NOT EXISTS team_payouts (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL,
  payout_type payout_type NOT NULL DEFAULT 'SALARY',
  payment_method payment_method NOT NULL DEFAULT 'MPESA_B2C',
  status payout_status NOT NULL DEFAULT 'PENDING',
  payout_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mpesa_conversation_id VARCHAR(100),
  mpesa_originator_conversation_id VARCHAR(100),
  mpesa_transaction_id VARCHAR(100),
  mpesa_recipient_number VARCHAR(50),
  reference_number VARCHAR(100),
  description TEXT,
  raw_response_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_payouts_tenant ON team_payouts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_team_payouts_user ON team_payouts(user_id);

CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id VARCHAR(64) REFERENCES projects(id) ON DELETE SET NULL,
  client_id VARCHAR(64) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  frequency maintenance_frequency NOT NULL DEFAULT 'MONTHLY',
  status maintenance_status NOT NULL DEFAULT 'ACTIVE',
  charge_amount NUMERIC(14, 2) NOT NULL,
  tax_type tax_type NOT NULL DEFAULT 'VAT_16',
  startDate TIMESTAMPTZ NOT NULL,
  next_due_date TIMESTAMPTZ NOT NULL,
  last_completed_date TIMESTAMPTZ,
  auto_invoice BOOLEAN NOT NULL DEFAULT TRUE,
  notify_days_before INT NOT NULL DEFAULT 3,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_tenant ON maintenance_schedules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_next_due ON maintenance_schedules(next_due_date);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE CASCADE,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  action audit_action NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(64),
  description TEXT NOT NULL,
  ip_address VARCHAR(50),
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- ──────────────────────────────────────────────
-- SESSION STORE TABLE (connect-pg-simple)
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON user_sessions(expire);

-- Document Templates Support
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS invoice_template VARCHAR(50) DEFAULT 'modern';
