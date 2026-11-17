import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import * as XLSX from 'xlsx';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ejs = require('ejs') as { renderFile: (filePath: string, data: Record<string, any>) => Promise<string> };

jest.mock('uuid', () => ({
  v4: () => '12345678-1234-4123-8123-123456789012',
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
import storageService from '../src/services/storage.service';
import projectController from '../src/controllers/ProjectController';
import { ProjectStatus, TaskPriority, TaskStatus, UserRole } from '../src/models/types';
import {
  sanitizeDownloadFilename,
  buildContentDisposition,
  classifyFile,
  matchesExpectedSignature,
  extractTextPreview,
  extractSpreadsheetPreview,
  extractZipEntries,
  extractDocxParagraphs,
} from '../src/utils/filePreview';

const mockedQuery = query as jest.MockedFunction<typeof query>;

/**
 * Build a minimal valid ZIP archive buffer in memory (stored or deflate) for testing.
 */
function buildTestZip(entries: Array<{ name: string; content: Buffer; deflate?: boolean }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const method = entry.deflate ? 8 : 0;
    const compData = entry.deflate ? zlib.deflateRawSync(entry.content) : entry.content;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(compData.length, 18);
    lh.writeUInt32LE(entry.content.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);

    localChunks.push(lh, nameBuf, compData);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(compData.length, 20);
    cd.writeUInt32LE(entry.content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);

    centralChunks.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + compData.length;
  }

  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localChunks, centralBuf, eocd]);
}

function createMockReqRes(overrides: Record<string, any> = {}) {
  const flashCalls: Array<{ type: string; msg: string }> = [];
  const headers: Record<string, string> = {};
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
      permissions: { projects: 'manage' },
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
    sentBody: null as any,
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    redirect: (url: string) => {
      res.redirectedTo = url;
    },
    render: (view: string, locals: any) => {
      res.renderedView = view;
      res.renderedLocals = locals;
    },
    json: (body: any) => {
      res.jsonBody = body;
    },
    send: (body: any) => {
      res.sentBody = body;
    },
  };

  const next = jest.fn();
  return { req, res, next, flashCalls, headers };
}

describe('File Preview Utilities', () => {
  test('sanitizes filenames and prevents header injection / path traversal', () => {
    expect(sanitizeDownloadFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeDownloadFilename('..\\..\\secret.pdf')).toBe('secret.pdf');
    expect(sanitizeDownloadFilename('report\r\nSet-Cookie: evil=1;"test".pdf')).toBe('report__Set-Cookie: evil=1__test_.pdf');

    const disp = buildContentDisposition('attachment', '../Quarterly Report "2026".pdf');
    expect(disp.startsWith('attachment; filename="')).toBe(true);
    expect(disp).not.toContain('\r');
    expect(disp).not.toContain('\n');
    expect(disp).toContain('Quarterly Report');
  });

  test('classifies supported document formats accurately even when title has no extension', () => {
    expect(classifyFile('Architectural Blueprint Rev 2', 'application/pdf', '/uploads/tenants/t1/projects/p1/123-abc.pdf').kind).toBe('pdf');
    expect(classifyFile('Site Photo', 'image/png', 'https://cdn.example.com/site.png')).toMatchObject({ kind: 'image', safeContentType: 'image/png', isSvg: false });
    expect(classifyFile('Diagram.svg', 'image/svg+xml').isSvg).toBe(true);
    expect(classifyFile('BOQ.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').kind).toBe('spreadsheet');
    expect(classifyFile('Contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document').kind).toBe('docx');
    expect(classifyFile('notes.txt', 'text/plain').kind).toBe('text');
    expect(classifyFile('archive.zip', 'application/zip').kind).toBe('zip');
    expect(classifyFile('legacy.doc', 'application/msword').kind).toBe('unsupported');
  });

  test('verifies magic bytes for PDF and images and rejects spoofed HTML payloads', () => {
    const pdfClass = classifyFile('doc.pdf', 'application/pdf');
    expect(matchesExpectedSignature(Buffer.from('%PDF-1.7\n...'), pdfClass)).toBe(true);
    expect(matchesExpectedSignature(Buffer.from('<html><script>alert(1)</script></html>'), pdfClass)).toBe(false);

    const pngClass = classifyFile('img.png', 'image/png');
    expect(matchesExpectedSignature(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), pngClass)).toBe(true);
    expect(matchesExpectedSignature(Buffer.from('<script>alert(1)</script>'), pngClass)).toBe(false);
  });

  test('extracts text, spreadsheet sheets, zip entries, and docx paragraphs safely', () => {
    const textPreview = extractTextPreview(Buffer.from('Line 1\nLine 2'));
    expect(textPreview).toEqual({ text: 'Line 1\nLine 2', truncated: false });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Item', 'Qty', 'Cost'],
      ['Router', 2, 15000],
      ['Cable', 10, 500],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Materials');
    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const sheets = extractSpreadsheetPreview(xlsxBuf, false);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Materials');
    expect(sheets[0].rows[0]).toEqual(['Item', 'Qty', 'Cost']);
    expect(sheets[0].rows[1]).toEqual(['Router', '2', '15000']);

    const docxXml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document><w:body>' +
      '<w:p><w:r><w:t>Project Scope &amp; Deliverables</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Phase 1 &lt;Core&gt;</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const docxBuf = buildTestZip([
      { name: 'word/document.xml', content: Buffer.from(docxXml, 'utf8'), deflate: true },
      { name: 'docProps/app.xml', content: Buffer.from('<Properties/>', 'utf8'), deflate: false },
    ]);

    const zipEntries = extractZipEntries(docxBuf);
    expect(zipEntries.map((e) => e.name)).toEqual(['word/document.xml', 'docProps/app.xml']);

    const paragraphs = extractDocxParagraphs(docxBuf);
    expect(paragraphs).toEqual(['Project Scope & Deliverables', 'Phase 1 <Core>']);
  });
});

describe('StorageService Local File Reading & Path Traversal Guard', () => {
  const testRelPath = 'tenants/__jest_test_tenant__/projects/p1/sample.txt';
  const testAbsPath = path.resolve(process.cwd(), 'public', 'uploads', testRelPath);

  beforeEach(() => {
    fs.mkdirSync(path.dirname(testAbsPath), { recursive: true });
    fs.writeFileSync(testAbsPath, 'Hello Project Storage');
  });

  afterEach(() => {
    fs.rmSync(path.resolve(process.cwd(), 'public', 'uploads', 'tenants', '__jest_test_tenant__'), {
      recursive: true,
      force: true,
    });
  });

  test('reads legitimate uploaded files and blocks directory traversal keys', async () => {
    const valid = await storageService.getFileBuffer(`/uploads/${testRelPath}`);
    expect(valid?.buffer.toString('utf8')).toBe('Hello Project Storage');

    expect(await storageService.getFileBuffer('/uploads/../../package.json')).toBeNull();
    expect(await storageService.getFileBuffer('..\\..\\package.json')).toBeNull();
    expect(await storageService.getFileBuffer('tenants/t1/file\0.txt')).toBeNull();
  });
});

describe('ProjectController - Edit Project, Edit/Complete Tasks, and Document Preview', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  test('showEdit renders edit view with clients for authorized project', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'proj-1', tenant_id: 'tenant-1', client_id: 'client-1', name: 'Fiber Rollout', code: 'PRJ-01', status: 'IN_PROGRESS' }],
        rowCount: 1,
      } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'client-1', name: 'Acme Corp', is_active: true }],
        rowCount: 1,
      } as any);

    const { req, res, next } = createMockReqRes({ params: { id: 'proj-1' } });
    await projectController.showEdit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.renderedView).toBe('pages/projects/edit');
    expect(res.renderedLocals.project.id).toBe('proj-1');
    expect(res.renderedLocals.clients).toHaveLength(1);
  });

  test('update validates fields, sets completedAt when COMPLETED, and updates project', async () => {
    mockedQuery
      // verifyProjectAccess
      .mockResolvedValueOnce({
        rows: [{ id: 'proj-1', tenant_id: 'tenant-1', client_id: null, name: 'Old Name', code: 'PRJ-01', status: 'IN_PROGRESS', budget: '1000', completed_at: null }],
        rowCount: 1,
      } as any)
      // verifyTenantClient
      .mockResolvedValueOnce({ rows: [{ id: 'client-2' }], rowCount: 1 } as any)
      // findByTenantAndCodeExcludingId
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      // ProjectModel.update
      .mockResolvedValueOnce({
        rows: [{
          id: 'proj-1',
          tenant_id: 'tenant-1',
          client_id: 'client-2',
          name: 'New Fiber Name',
          code: 'PRJ-01',
          description: 'Updated scope',
          status: 'COMPLETED',
          budget: '250000',
          start_date: '2026-09-01T00:00:00.000Z',
          end_date: '2026-12-31T00:00:00.000Z',
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      } as any);

    const { req, res, next, flashCalls } = createMockReqRes({
      params: { id: 'proj-1' },
      body: {
        name: 'New Fiber Name',
        code: 'PRJ-01',
        clientId: 'client-2',
        budget: '250000',
        status: ProjectStatus.COMPLETED,
        startDate: '2026-09-01',
        endDate: '2026-12-31',
        description: 'Updated scope',
      },
    });

    await projectController.update(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('/projects/proj-1');
    expect(flashCalls.some((f) => f.type === 'success')).toBe(true);
    const updateCall = mockedQuery.mock.calls[3];
    expect(updateCall[0]).toContain('UPDATE projects SET');
    expect(updateCall[1]?.[4]).toBe(ProjectStatus.COMPLETED);
    expect(updateCall[1]?.[8]).toBeInstanceOf(Date);
  });

  test('updateTaskStatus lets assigned TEAM_MEMBER mark task COMPLETED and rejects CLIENT_PORTAL', async () => {
    // 1. TEAM_MEMBER assigned to project succeeds
    mockedQuery
      // verifyProjectAccess -> project
      .mockResolvedValueOnce({
        rows: [{ id: 'proj-1', tenant_id: 'tenant-1', name: 'Fiber' }],
        rowCount: 1,
      } as any)
      // verifyProjectAccess -> assigned check
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 } as any)
      // TaskModel.findByIdAndProject
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          tenant_id: 'tenant-1',
          project_id: 'proj-1',
          title: 'Splice fiber',
          status: 'TODO',
          priority: 'HIGH',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      } as any)
      // TaskModel.updateStatus
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          tenant_id: 'tenant-1',
          project_id: 'proj-1',
          title: 'Splice fiber',
          status: 'COMPLETED',
          priority: 'HIGH',
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      } as any);

    const teamCtx = createMockReqRes({
      params: { id: 'proj-1', taskId: 'task-1' },
      body: { status: TaskStatus.COMPLETED },
      user: {
        id: 'member-1',
        tenantId: 'tenant-1',
        role: UserRole.TEAM_MEMBER,
        projectScope: 'ASSIGNED',
        permissions: { projects: 'view' },
      },
    });

    await projectController.updateTaskStatus(teamCtx.req, teamCtx.res, teamCtx.next);
    expect(teamCtx.res.redirectedTo).toBe('/projects/proj-1');
    expect(teamCtx.flashCalls[0].type).toBe('success');

    // 2. CLIENT_PORTAL read-only user is blocked
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'proj-1', tenant_id: 'tenant-1', name: 'Fiber' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 } as any);

    const portalCtx = createMockReqRes({
      params: { id: 'proj-1', taskId: 'task-1' },
      body: { status: TaskStatus.COMPLETED },
      xhr: true,
      user: {
        id: 'client-user',
        tenantId: 'tenant-1',
        role: UserRole.CLIENT_PORTAL,
        projectScope: 'ASSIGNED',
        permissions: { projects: 'view' },
      },
    });

    await projectController.updateTaskStatus(portalCtx.req, portalCtx.res, portalCtx.next);
    expect(portalCtx.res.statusCode).toBe(403);
  });

  test('updateTask updates all fields cleanly', async () => {
    mockedQuery
      // verifyProjectAccess
      .mockResolvedValueOnce({
        rows: [{ id: 'proj-1', tenant_id: 'tenant-1', name: 'Fiber' }],
        rowCount: 1,
      } as any)
      // TaskModel.findByIdAndProject
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          tenant_id: 'tenant-1',
          project_id: 'proj-1',
          assigned_to_id: null,
          title: 'Old Task',
          description: null,
          status: 'TODO',
          priority: 'MEDIUM',
          estimated_hours: null,
          actual_hours: null,
          due_date: null,
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      } as any)
      // verifyTenantUser
      .mockResolvedValueOnce({ rows: [{ id: 'user-2' }], rowCount: 1 } as any)
      // TaskModel.update
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          tenant_id: 'tenant-1',
          project_id: 'proj-1',
          assigned_to_id: 'user-2',
          title: 'Updated Task Title',
          description: 'New notes',
          status: 'IN_REVIEW',
          priority: 'URGENT',
          estimated_hours: '6',
          actual_hours: '4.5',
          due_date: '2026-11-30T00:00:00.000Z',
          completed_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        rowCount: 1,
      } as any);

    const { req, res, next, flashCalls } = createMockReqRes({
      params: { id: 'proj-1', taskId: 'task-1' },
      body: {
        title: 'Updated Task Title',
        description: 'New notes',
        assignedToId: 'user-2',
        status: TaskStatus.IN_REVIEW,
        priority: TaskPriority.URGENT,
        dueDate: '2026-11-30',
        estimatedHours: '6',
        actualHours: '4.5',
      },
    });

    await projectController.updateTask(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('/projects/proj-1');
    expect(flashCalls[0].type).toBe('success');
  });

  test('previewDocument and previewDocumentData serve safe headers and structured previews', async () => {
    const testRelPath = 'tenants/__jest_preview__/projects/proj-1/diagram.svg';
    const testAbsPath = path.resolve(process.cwd(), 'public', 'uploads', testRelPath);
    fs.mkdirSync(path.dirname(testAbsPath), { recursive: true });
    fs.writeFileSync(testAbsPath, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');

    try {
      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', tenant_id: 'tenant-1', name: 'Fiber' }], rowCount: 1 } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'doc-1',
            tenant_id: 'tenant-1',
            project_id: 'proj-1',
            name: 'Network Topology',
            file_url: `/uploads/${testRelPath}`,
            file_size: 80,
            file_type: 'image/svg+xml',
          }],
          rowCount: 1,
        } as any);

      const previewCtx = createMockReqRes({ params: { id: 'proj-1', docId: 'doc-1' } });
      await projectController.previewDocument(previewCtx.req, previewCtx.res, previewCtx.next);

      expect(previewCtx.headers['x-content-type-options']).toBe('nosniff');
      expect(previewCtx.headers['cache-control']).toBe('private, no-store');
      expect(previewCtx.headers['content-type']).toBe('image/svg+xml');
      expect(previewCtx.headers['content-security-policy']).toContain('sandbox');
      expect(previewCtx.headers['content-disposition']).toContain('inline');

      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', tenant_id: 'tenant-1', name: 'Fiber' }], rowCount: 1 } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'doc-1',
            tenant_id: 'tenant-1',
            project_id: 'proj-1',
            name: 'Network Topology',
            file_url: `/uploads/${testRelPath}`,
            file_size: 80,
            file_type: 'image/svg+xml',
          }],
          rowCount: 1,
        } as any);

      const dataCtx = createMockReqRes({ params: { id: 'proj-1', docId: 'doc-1' } });
      await projectController.previewDocumentData(dataCtx.req, dataCtx.res, dataCtx.next);

      expect(dataCtx.res.jsonBody).toMatchObject({
        kind: 'image',
        isSvg: true,
        fileName: 'Network Topology.svg',
        previewUrl: '/projects/proj-1/documents/doc-1/preview',
        downloadUrl: '/projects/proj-1/documents/doc-1/download',
      });

      // PDF inline preview sets object-src 'self' and frame-ancestors 'self' for iframe PDF viewers
      const pdfRelPath = 'tenants/__jest_preview__/projects/proj-1/spec.pdf';
      const pdfAbsPath = path.resolve(process.cwd(), 'public', 'uploads', pdfRelPath);
      fs.writeFileSync(pdfAbsPath, '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

      mockedQuery
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', tenant_id: 'tenant-1', name: 'Fiber' }], rowCount: 1 } as any)
        .mockResolvedValueOnce({
          rows: [{
            id: 'doc-2',
            tenant_id: 'tenant-1',
            project_id: 'proj-1',
            name: 'Technical Spec',
            file_url: `/uploads/${pdfRelPath}`,
            file_size: 40,
            file_type: 'application/pdf',
          }],
          rowCount: 1,
        } as any);

      const pdfCtx = createMockReqRes({ params: { id: 'proj-1', docId: 'doc-2' } });
      await projectController.previewDocument(pdfCtx.req, pdfCtx.res, pdfCtx.next);
      expect(pdfCtx.headers['content-type']).toBe('application/pdf');
      expect(pdfCtx.headers['content-disposition']).toContain('inline');
      expect(pdfCtx.headers['content-security-policy']).toContain("object-src 'self'");
      expect(pdfCtx.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    } finally {
      fs.rmSync(path.resolve(process.cwd(), 'public', 'uploads', 'tenants', '__jest_preview__'), {
        recursive: true,
        force: true,
      });
    }
  });
});

describe('EJS Template Rendering & XSS Escaping Verification', () => {
  const viewsRoot = path.resolve(process.cwd(), 'src', 'views');

  test('renders projects/edit.ejs, projects/index.ejs, and projects/show.ejs cleanly and escapes XSS payloads', async () => {
    const xssStr = '"><script>alert("xss")</script>';
    const commonHelpers = {
      hasModuleAccess: () => true,
      formatKES: (v: number) => `KES ${v.toFixed(2)}`,
    };

    const editHtml = await ejs.renderFile(path.join(viewsRoot, 'pages/projects/edit.ejs'), {
      ...commonHelpers,
      project: {
        id: 'proj-1',
        name: `Test ${xssStr}`,
        code: 'PRJ-01',
        client_id: 'c1',
        budget: '50000',
        status: 'IN_PROGRESS',
        start_date: '2026-09-01',
        end_date: '2026-10-01',
        description: `Desc ${xssStr}`,
      },
      clients: [{ id: 'c1', name: 'Client A', is_active: true }],
    });
    expect(editHtml).toContain('action="/projects/proj-1/edit"');
    expect(editHtml).not.toContain('<script>alert("xss")</script>');

    const indexHtml = await ejs.renderFile(path.join(viewsRoot, 'pages/projects/index.ejs'), {
      ...commonHelpers,
      projects: [{
        id: 'proj-1',
        code: 'PRJ-01',
        name: `Test ${xssStr}`,
        description: 'Desc',
        client_name: 'Client A',
        budget: '1000',
        completed_task_count: 1,
        task_count: 2,
        status: 'ON_HOLD',
      }],
      filters: {},
      pagination: null,
    });
    expect(indexHtml).toContain('href="/projects/proj-1/edit"');
    expect(indexHtml).not.toContain('<script>alert("xss")</script>');

    const showHtml = await ejs.renderFile(path.join(viewsRoot, 'pages/projects/show.ejs'), {
      ...commonHelpers,
      canModifyTasks: true,
      project: {
        id: 'proj-1',
        name: `Project ${xssStr}`,
        code: 'PRJ-01',
        client_name: 'Client A',
        status: 'IN_PROGRESS',
        budget: '50000',
        start_date: '2026-09-01',
        end_date: '2026-10-01',
        description: 'Overview',
      },
      tasks: [{
        id: 'task-1',
        title: `Task ${xssStr}`,
        description: `Task Desc ${xssStr}`,
        first_name: 'Jane',
        last_name: 'Doe',
        assigned_to_id: 'u1',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        due_date: '2026-10-15',
        estimated_hours: 4,
        actual_hours: 2,
      }],
      documents: [{
        id: 'doc-1',
        name: `Blueprint ${xssStr}.pdf`,
        file_url: '/uploads/test.pdf',
        file_size: 2048,
        file_type: 'application/pdf',
        first_name: 'Jane',
        last_name: 'Doe',
        created_at: new Date().toISOString(),
      }],
      members: [],
      teamMembers: [],
      availableUsers: [{ id: 'u1', first_name: 'Jane', last_name: 'Doe', role: 'TEAM_MEMBER' }],
      teamUsers: [{ id: 'u1', first_name: 'Jane', last_name: 'Doe', role: 'TEAM_MEMBER' }],
      invoices: [],
      quotations: [],
      expenses: [],
    });

    expect(showHtml).toContain('href="/projects/proj-1/edit"');
    expect(showHtml).toContain('action="/projects/proj-1/tasks/task-1/status"');
    expect(showHtml).toContain('id="modalEditTask"');
    expect(showHtml).toContain('id="modalPreviewDocument"');
    expect(showHtml).toContain('/projects/proj-1/documents/doc-1/preview-data');
    expect(showHtml).toContain('/projects/proj-1/documents/doc-1/download');
    expect(showHtml).not.toContain('<script>alert("xss")</script>');
  });
});
