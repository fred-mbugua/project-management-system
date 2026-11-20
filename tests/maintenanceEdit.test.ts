import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ejs = require('ejs') as { renderFile: (filePath: string, data: Record<string, any>) => Promise<string> };

jest.mock('uuid', () => ({
  v4: () => '12345678-1234-4123-8123-123456789012',
}));

jest.mock('puppeteer-core', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
  testConnection: jest.fn(),
  pool: { on: jest.fn() },
  default: {},
}));

jest.mock('../src/services/actionLog.service', () => ({
  __esModule: true,
  default: { record: jest.fn().mockResolvedValue(undefined) },
  ActionLogService: { record: jest.fn().mockResolvedValue(undefined) },
}));

import { query } from '../src/config/database';
import ActionLogService from '../src/services/actionLog.service';
import maintenanceController from '../src/controllers/MaintenanceController';
import { MaintenanceModel } from '../src/models/maintenance.model';
import { MaintenanceFrequency, MaintenanceStatus, TaxType, UserRole } from '../src/models/types';

const mockedQuery = query as jest.MockedFunction<typeof query>;

function createMockReqRes(overrides: Record<string, any> = {}) {
  const flashCalls: Array<{ type: string; msg: string }> = [];
  const req: any = {
    params: {},
    body: {},
    query: {},
    headers: {},
    xhr: false,
    tenantId: 'tenant-1',
    user: {
      id: 'user-1',
      tenantId: 'tenant-1',
      role: UserRole.TENANT_OWNER,
      projectScope: 'ALL',
      permissions: { maintenance: 'manage' },
    },
    flash: (type: string, msg: string) => {
      flashCalls.push({ type, msg });
    },
    ...overrides,
  };

  const res: any = {
    statusCode: 200,
    redirectedTo: null as string | null,
    renderedView: null as string | null,
    renderedLocals: null as any,
    jsonBody: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    redirect(url: string) {
      this.redirectedTo = url;
    },
    render(view: string, locals: any) {
      this.renderedView = view;
      this.renderedLocals = locals;
    },
    json(body: any) {
      this.jsonBody = body;
    },
  };

  const next = jest.fn();
  return { req, res, next, flashCalls };
}

function makeScheduleRow(overrides: Record<string, any> = {}) {
  return {
    id: 'sched-1',
    tenant_id: 'tenant-1',
    project_id: 'proj-1',
    client_id: 'client-1',
    title: 'Cloud Hosting & Support SLA',
    description: null,
    frequency: MaintenanceFrequency.MONTHLY,
    interval_months: 1,
    status: MaintenanceStatus.ACTIVE,
    charge_amount: '5000.00',
    tax_type: TaxType.VAT_16,
    tax_rate: '16.00',
    startdate: '2026-11-01T00:00:00.000Z',
    next_due_date: '2026-12-01T00:00:00.000Z',
    end_date: null,
    last_completed_date: null,
    last_invoice_id: 'inv-1',
    auto_invoice: true,
    auto_send_email: true,
    notify_days_before: 7,
    notes: '24/7 uptime monitoring',
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    client_name: 'Zuri Luxe Events',
    project_name: 'IMS',
    project_code: 'PRJ-006',
    last_invoice_number: 'INV-2026-0003',
    invoice_count: 1,
    ...overrides,
  };
}

describe('MaintenanceController - Edit Maintenance Contracts', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    jest.clearAllMocks();
  });

  test('showEdit renders maintenance/edit with schedule, clients, and projects', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [makeScheduleRow()], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'client-1', name: 'Zuri Luxe Events', is_active: true }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'proj-1', name: 'IMS', code: 'PRJ-006', status: 'IN_PROGRESS' }], rowCount: 1 } as any);

    const { req, res, next } = createMockReqRes({ params: { id: 'sched-1' } });
    await maintenanceController.showEdit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.renderedView).toBe('pages/maintenance/edit');
    expect(res.renderedLocals.schedule.id).toBe('sched-1');
    expect(res.renderedLocals.schedule.chargeAmount).toBe(5000);
    expect(res.renderedLocals.clients).toHaveLength(1);
    expect(res.renderedLocals.projects).toHaveLength(1);
  });

  test('showEdit blocks assigned-only users from unassigned contracts', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [makeScheduleRow()], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const { req, res, next, flashCalls } = createMockReqRes({
      params: { id: 'sched-1' },
      user: {
        id: 'member-1',
        tenantId: 'tenant-1',
        role: UserRole.PROJECT_MANAGER,
        projectScope: 'ASSIGNED',
        permissions: { maintenance: 'manage' },
      },
    });

    await maintenanceController.showEdit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('/maintenance');
    expect(flashCalls[0].type).toBe('error');
  });

  test('update validates inputs, updates maintenance_schedules, and records audit log', async () => {
    const updatedRow = makeScheduleRow({
      title: 'Updated Cloud Retainer SLA',
      client_id: 'client-2',
      project_id: 'proj-2',
      frequency: MaintenanceFrequency.CUSTOM,
      interval_months: 4,
      status: MaintenanceStatus.PAUSED,
      charge_amount: '12500.00',
      tax_type: TaxType.ZERO_RATED,
      tax_rate: '0.00',
      startdate: '2026-10-15T00:00:00.000Z',
      next_due_date: '2027-02-15T00:00:00.000Z',
      end_date: '2027-12-31T00:00:00.000Z',
      auto_invoice: false,
      auto_send_email: false,
      notify_days_before: 14,
      notes: 'Updated deliverables scope',
    });

    mockedQuery
      // verifyScheduleAccess -> MaintenanceModel.findByIdAndTenant
      .mockResolvedValueOnce({ rows: [makeScheduleRow()], rowCount: 1 } as any)
      // clientCheck
      .mockResolvedValueOnce({ rows: [{ id: 'client-2' }], rowCount: 1 } as any)
      // projCheck
      .mockResolvedValueOnce({ rows: [{ id: 'proj-2' }], rowCount: 1 } as any)
      // MaintenanceModel.update
      .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 } as any);

    const { req, res, next, flashCalls } = createMockReqRes({
      params: { id: 'sched-1' },
      body: {
        title: 'Updated Cloud Retainer SLA',
        clientId: 'client-2',
        projectId: 'proj-2',
        frequency: MaintenanceFrequency.CUSTOM,
        intervalMonths: '4',
        status: MaintenanceStatus.PAUSED,
        chargeAmount: '12500',
        taxRate: '0',
        startDate: '2026-10-15',
        nextDueDate: '2027-02-15',
        endDate: '2027-12-31',
        notifyDaysBefore: '14',
        notes: 'Updated deliverables scope',
      },
    });

    await maintenanceController.update(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('/maintenance');
    expect(flashCalls.some((f) => f.type === 'success')).toBe(true);

    const updateCall = mockedQuery.mock.calls[3];
    expect(updateCall[0]).toContain('UPDATE maintenance_schedules SET');
    expect(updateCall[1]?.[2]).toBe('Updated Cloud Retainer SLA');
    expect(updateCall[1]?.[3]).toBe(MaintenanceFrequency.CUSTOM);
    expect(updateCall[1]?.[4]).toBe(4);
    expect(updateCall[1]?.[5]).toBe(MaintenanceStatus.PAUSED);
    expect(updateCall[1]?.[6]).toBe(12500);
    expect(updateCall[1]?.[7]).toBe(TaxType.ZERO_RATED);
    expect(updateCall[1]?.[12]).toBe(false);
    expect(updateCall[1]?.[13]).toBe(false);
    expect(updateCall[1]?.[14]).toBe(14);
    expect(ActionLogService.record).toHaveBeenCalledTimes(1);
  });

  test('update rejects cross-tenant client and invalid endDate < startDate', async () => {
    // 1. Cross-tenant client rejected
    mockedQuery
      .mockResolvedValueOnce({ rows: [makeScheduleRow()], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const badClientCtx = createMockReqRes({
      params: { id: 'sched-1' },
      body: {
        title: 'Test',
        clientId: 'other-tenant-client',
        frequency: MaintenanceFrequency.MONTHLY,
        status: MaintenanceStatus.ACTIVE,
        chargeAmount: '1000',
        taxRate: '16',
        startDate: '2026-11-01',
        nextDueDate: '2026-12-01',
      },
    });
    await maintenanceController.update(badClientCtx.req, badClientCtx.res, badClientCtx.next);
    expect(badClientCtx.res.redirectedTo).toBe('/maintenance/sched-1/edit');
    expect(badClientCtx.flashCalls[0].type).toBe('error');

    // 2. End date earlier than start date rejected
    mockedQuery
      .mockResolvedValueOnce({ rows: [makeScheduleRow()], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'client-1' }], rowCount: 1 } as any);

    const badDatesCtx = createMockReqRes({
      params: { id: 'sched-1' },
      body: {
        title: 'Test',
        clientId: 'client-1',
        frequency: MaintenanceFrequency.MONTHLY,
        status: MaintenanceStatus.ACTIVE,
        chargeAmount: '1000',
        taxRate: '16',
        startDate: '2026-12-01',
        nextDueDate: '2026-12-01',
        endDate: '2026-11-01',
      },
    });
    await maintenanceController.update(badDatesCtx.req, badDatesCtx.res, badDatesCtx.next);
    expect(badDatesCtx.res.redirectedTo).toBe('/maintenance/sched-1/edit');
    expect(badDatesCtx.flashCalls[0].msg).toContain('End Date');
  });

  test('MaintenanceModel.update scopes query by tenantId when provided', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [makeScheduleRow()], rowCount: 1 } as any);

    await MaintenanceModel.update('sched-1', 'tenant-1', {
      clientId: 'client-1',
      projectId: null,
      title: 'Scoped Update',
      frequency: MaintenanceFrequency.MONTHLY,
      intervalMonths: 1,
      status: MaintenanceStatus.ACTIVE,
      chargeAmount: 5000,
      taxType: TaxType.VAT_16,
      taxRate: 16,
      startDate: new Date('2026-11-01'),
      nextDueDate: new Date('2026-12-01'),
      endDate: null,
      autoInvoice: true,
      autoSendEmail: true,
      notifyDaysBefore: 7,
      notes: null,
    });

    expect(mockedQuery.mock.calls[0][0]).toContain('WHERE id = $17 AND tenant_id = $18');
    expect(mockedQuery.mock.calls[0][1]?.[17]).toBe('tenant-1');
  });
});

describe('Maintenance EJS Views Rendering & XSS Escaping', () => {
  const viewsRoot = path.resolve(process.cwd(), 'src', 'views');

  test('renders maintenance/edit.ejs and maintenance/index.ejs safely', async () => {
    const xss = '"><script>alert("xss")</script>';
    const helpers = {
      hasModuleAccess: () => true,
      formatKES: (v: number) => `KES ${v.toFixed(2)}`,
    };

    const editHtml = await ejs.renderFile(path.join(viewsRoot, 'pages/maintenance/edit.ejs'), {
      ...helpers,
      schedule: {
        id: 'sched-1',
        title: `Retainer ${xss}`,
        clientId: 'client-1',
        clientName: `Client ${xss}`,
        projectId: 'proj-1',
        frequency: 'CUSTOM',
        intervalMonths: 3,
        status: 'ACTIVE',
        chargeAmount: 5000,
        taxRate: 16,
        notifyDaysBefore: 7,
        startDate: new Date('2026-11-01T00:00:00.000Z'),
        nextDueDate: new Date('2026-12-01T00:00:00.000Z'),
        endDate: null,
        notes: `Notes ${xss}`,
        autoInvoice: true,
        autoSendEmail: true,
        invoiceCount: 2,
        lastInvoiceNumber: 'INV-2026-0003',
      },
      clients: [{ id: 'client-1', name: 'Acme', is_active: true }],
      projects: [{ id: 'proj-1', name: 'IMS', code: 'PRJ-006' }],
    });

    expect(editHtml).toContain('action="/maintenance/sched-1/edit"');
    expect(editHtml).toContain('/js/maintenance-edit.js');
    expect(editHtml).not.toContain('<script>alert("xss")</script>');

    const indexHtml = await ejs.renderFile(path.join(viewsRoot, 'pages/maintenance/index.ejs'), {
      ...helpers,
      stats: { activeCount: 1, totalMRR: 5000, totalSchedules: 1 },
      clients: [{ id: 'client-1', name: 'Acme' }],
      projects: [{ id: 'proj-1', name: 'IMS', code: 'PRJ-006' }],
      schedules: [{
        id: 'sched-1',
        title: `Contract ${xss}`,
        client_name: 'Acme',
        client_email: 'a@acme.test',
        client_phone: '',
        project_name: 'IMS',
        project_code: 'PRJ-006',
        frequency: 'MONTHLY',
        interval_months: 1,
        startdate: '2026-11-01T00:00:00.000Z',
        next_due_date: '2026-12-01T00:00:00.000Z',
        charge_amount: '5000',
        tax_rate: 16,
        status: 'PAUSED',
        invoice_count: 1,
        schedule_invoices: [],
        last_invoice_number: 'INV-2026-0003',
        last_invoice_status: 'SENT',
        last_invoice_token: 'tok-1',
        notes: 'Scope',
      }],
      filters: {},
      pagination: null,
    });

    expect(indexHtml).toContain('href="/maintenance/sched-1/edit"');
    expect(indexHtml).toContain('value="COMPLETED"');
    expect(indexHtml).not.toContain('value="EXPIRED"');
    expect(indexHtml).not.toContain('<script>alert("xss")</script>');
  });
});
