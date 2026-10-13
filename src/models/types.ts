// ══════════════════════════════════════════════════════════════════════
// Database Types & Domain Enums
// Replaces ORM-generated types with native TypeScript definitions
// ══════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────
// ENUMS
// ──────────────────────────────────────────────

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  TENANT_OWNER = 'TENANT_OWNER',
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  ACCOUNTANT = 'ACCOUNTANT',
  TEAM_MEMBER = 'TEAM_MEMBER',
  CLIENT_PORTAL = 'CLIENT_PORTAL',
}

export enum ProjectStatus {
  PLANNING = 'PLANNING',
  IN_PROGRESS = 'IN_PROGRESS',
  ON_HOLD = 'ON_HOLD',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  COMPLETED = 'COMPLETED',
  BLOCKED = 'BLOCKED',
}

export enum QuotationStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  CONVERTED = 'CONVERTED',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  UNPAID = 'UNPAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
  VOID = 'VOID',
}

export enum PaymentMethod {
  MPESA_STK = 'MPESA_STK',
  MPESA_C2B = 'MPESA_C2B',
  MPESA_B2C = 'MPESA_B2C',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH = 'CASH',
  CHEQUE = 'CHEQUE',
  CARD = 'CARD',
  PAYPAL = 'PAYPAL',
  MANUAL = 'MANUAL',
  OTHER = 'OTHER',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export enum TaxType {
  VAT_16 = 'VAT_16',
  ZERO_RATED = 'ZERO_RATED',
  EXEMPT = 'EXEMPT',
  WITHHOLDING_3 = 'WITHHOLDING_3',
  WITHHOLDING_5 = 'WITHHOLDING_5',
  CUSTOM = 'CUSTOM',
}

export enum ExpenseCategory {
  MATERIALS = 'MATERIALS',
  LABOUR = 'LABOUR',
  TRANSPORT = 'TRANSPORT',
  EQUIPMENT = 'EQUIPMENT',
  SUBCONTRACTOR = 'SUBCONTRACTOR',
  UTILITIES = 'UTILITIES',
  OFFICE = 'OFFICE',
  MARKETING = 'MARKETING',
  INSURANCE = 'INSURANCE',
  LICENSE_PERMITS = 'LICENSE_PERMITS',
  MISCELLANEOUS = 'MISCELLANEOUS',
}

export enum MaintenanceFrequency {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  BIANNUAL = 'BIANNUAL',
  ANNUAL = 'ANNUAL',
  CUSTOM = 'CUSTOM',
}

export enum MaintenanceStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum SubscriptionTier {
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  CANCELED = 'CANCELED',
  TRIAL = 'TRIAL',
  SUSPENDED = 'SUSPENDED',
  EXPIRED = 'EXPIRED',
}

export enum DarajaShortcodeType {
  PAYBILL = 'PAYBILL',
  TILL = 'TILL',
}

export enum PayoutType {
  SALARY = 'SALARY',
  WAGE = 'WAGE',
  EXPENSE_CLAIM = 'EXPENSE_CLAIM',
  BONUS = 'BONUS',
  COMMISSION = 'COMMISSION',
}

export enum PayoutStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  PAYMENT = 'PAYMENT',
  EXPORT = 'EXPORT',
  IMPORT = 'IMPORT',
  SETTINGS_CHANGE = 'SETTINGS_CHANGE',
}

// ──────────────────────────────────────────────
// ENTITY INTERFACES
// ──────────────────────────────────────────────

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: SubscriptionTier;
  monthlyPrice: number;
  annualPrice: number;
  price?: number;
  frequency?: string;
  intervalMonths?: number;
  description?: string;
  maxUsers: number;
  maxProjects: number;
  maxStorageMb: number;
  features?: Record<string, any> | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantDisplayFields {
  showTenantPhone?: boolean;
  showTenantEmail?: boolean;
  showTenantAddress?: boolean;
  showTenantKraPin?: boolean;
  showClientPhone?: boolean;
  showClientEmail?: boolean;
  showClientAddress?: boolean;
  showClientKraPin?: boolean;
  showBankDetails?: boolean;
  showPaymentTerms?: boolean;
  showMpesaDetails?: boolean;
  showTaxBreakdown?: boolean;
  showDiscount?: boolean;
  showProject?: boolean;
  showNotes?: boolean;
  showTerms?: boolean;
  showEtimsQr?: boolean;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country: string;
  kraPin?: string | null;
  vatRegistered: boolean;
  defaultTaxType: TaxType;
  logoUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  invoicePrefix: string;
  quotePrefix: string;
  invoiceTemplate?: string;
  displayFields?: TenantDisplayFields;
  invoiceNotes?: string | null;
  paymentTerms?: string | null;
  bankDetails?: string | null;
  darajaConsumerKey?: string | null;
  darajaConsumerSecret?: string | null;
  darajaPasskey?: string | null;
  darajaShortcode?: string | null;
  darajaShortcodeType: DarajaShortcodeType;
  darajaEnvironment: string;
  cardGatewayProvider?: string | null;
  cardPublicKey?: string | null;
  cardSecretKey?: string | null;
  cardEnabled?: boolean;
  receiptFields?: Record<string, any> | null;
  subscriptionExempt?: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSubscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  autoRenew: boolean;
  mpesaReceiptNo?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PermissionLevel = 'none' | 'view' | 'manage';
export type ProjectScope = 'ALL' | 'ASSIGNED';

export interface UserModulePermissions {
  projects: PermissionLevel;
  calendar: PermissionLevel;
  maintenance: PermissionLevel;
  quotations: PermissionLevel;
  invoices: PermissionLevel;
  expenses: PermissionLevel;
  accounting: PermissionLevel;
  team: PermissionLevel;
  clients: PermissionLevel;
  settings: PermissionLevel;
  audit_logs: PermissionLevel;
}

export interface User {
  id: string;
  tenantId?: string | null;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  nationalId?: string | null;
  role: UserRole;
  projectScope?: ProjectScope;
  permissions?: UserModulePermissions | null;
  mpesaNumber?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  hourlyRate?: number | null;
  fixedRate?: number | null;
  avatarUrl?: string | null;
  isActive: boolean;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithTenant extends User {
  tenant?: {
    id: string;
    name: string;
    isActive: boolean;
  } | null;
}

export interface Client {
  id: string;
  tenantId: string;
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country: string;
  kraPin?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  tenantId: string;
  clientId?: string | null;
  name: string;
  code: string;
  description?: string | null;
  status: ProjectStatus;
  budget?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  roleInProject?: string | null;
  rateType: string;
  rate?: number | null;
  joinedAt: Date;
}

export interface Task {
  id: string;
  tenantId: string;
  projectId: string;
  assignedToId?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Quotation {
  id: string;
  tenantId: string;
  clientId: string;
  projectId?: string | null;
  quotationNumber: string;
  title?: string | null;
  status: QuotationStatus;
  issueDate: Date;
  validUntil: Date;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  notes?: string | null;
  terms?: string | null;
  template?: string;
  customColor?: string | null;
  convertedInvoiceId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotationItem {
  id: string;
  quotationId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxType: TaxType;
  taxRate: number;
  lineTotal: number;
  lineTax: number;
  sortOrder: number;
}

export interface Invoice {
  id: string;
  tenantId: string;
  clientId: string;
  projectId?: string | null;
  quotationId?: string | null;
  invoiceNumber: string;
  title?: string | null;
  status: InvoiceStatus;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  notes?: string | null;
  terms?: string | null;
  template: string;
  customColor?: string | null;
  etimsVerificationHash?: string | null;
  etimsQrPayload?: string | null;
  tenantKraPin?: string | null;
  clientKraPin?: string | null;
  includeVat?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxType: TaxType;
  taxRate: number;
  lineTotal: number;
  lineTax: number;
  sortOrder: number;
}

export interface Payment {
  id: string;
  tenantId: string;
  invoiceId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  paymentDate: Date;
  receiptNumber?: string | null;
  mpesaReceiptNumber?: string | null;
  mpesaPhoneNumber?: string | null;
  mpesaTransactionDate?: string | null;
  mpesaCheckoutRequestId?: string | null;
  mpesaMerchantRequestId?: string | null;
  referenceNumber?: string | null;
  proofUrl?: string | null;
  proofFilename?: string | null;
  recordedByUserId?: string | null;
  notes?: string | null;
  rawCallbackData?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface Expense {
  id: string;
  tenantId: string;
  projectId?: string | null;
  category: ExpenseCategory;
  description: string;
  amount: number;
  vatAmount: number;
  taxDeductible: boolean;
  billable: boolean;
  receiptUrl?: string | null;
  expenseDate: Date;
  vendor?: string | null;
  referenceNo?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamPayout {
  id: string;
  tenantId: string;
  userId: string;
  amount: number;
  payoutType: PayoutType;
  paymentMethod: PaymentMethod;
  status: PayoutStatus;
  payoutDate: Date;
  mpesaConversationId?: string | null;
  mpesaOriginatorConversationId?: string | null;
  mpesaTransactionId?: string | null;
  mpesaRecipientNumber?: string | null;
  referenceNumber?: string | null;
  description?: string | null;
  rawResponseData?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaintenanceSchedule {
  id: string;
  tenantId: string;
  projectId?: string | null;
  clientId: string;
  title: string;
  description?: string | null;
  frequency: MaintenanceFrequency;
  status: MaintenanceStatus;
  chargeAmount: number;
  taxType: TaxType;
  startDate: Date;
  nextDueDate: Date;
  lastCompletedDate?: Date | null;
  autoInvoice: boolean;
  notifyDaysBefore: number;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  tenantId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  description: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: any;
  createdAt: Date;
}

export interface ProjectDocument {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  fileUrl: string;
  fileSize: number;
  fileType?: string | null;
  uploadedById?: string | null;
  uploadedByName?: string | null;
  createdAt: Date;
}

export interface SubscriptionInvoice {
  id: string;
  tenantId: string;
  planId?: string | null;
  invoiceNumber: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  dueDate: Date;
  paidAt?: Date | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paymentInstructions?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

