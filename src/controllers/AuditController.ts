// ══════════════════════════════════════════════════════════════════════
// Audit & Error Diagnostics Controller
// Action logs inspection, filterable audit trails, and system error logs
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { AuditLogModel } from '../models/auditLog.model';
import { ErrorLogModel } from '../models/errorLog.model';
import { extractPaginationParams, calculatePagination } from '../utils/pagination';
import logger from '../utils/logger';

const auditLogger = logger.child('AuditController');

export class AuditController {
  /**
   * Action & Audit Logs view for Tenant Owners & Super Admins
   */
  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const isSuper = req.user?.role === 'SUPER_ADMIN';
      const tenantId = req.tenantId;

      if (!tenantId && !isSuper) {
        res.redirect('/auth/login');
        return;
      }

      const params = extractPaginationParams(req, 20);
      const actionFilter = req.query.action as string | undefined;

      const effectiveTenantId = isSuper ? (req.query.tenantId as string || null) : (tenantId || null);

      const [logs, total] = await Promise.all([
        AuditLogModel.findWithUser({
          tenantId: effectiveTenantId,
          action: actionFilter && actionFilter.trim() !== '' ? actionFilter : undefined,
          limit: params.limit,
          offset: params.offset,
        }),
        AuditLogModel.count({
          tenantId: effectiveTenantId,
          action: actionFilter && actionFilter.trim() !== '' ? actionFilter : undefined,
        }),
      ]);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/audit/index', {
        title: 'Action & Audit Logs',
        logs,
        pagination,
        search: params.search,
        selectedAction: actionFilter || '',
        currentPath: req.baseUrl || '/audit-logs',
      });
    } catch (error) {
      auditLogger.error('Failed to load audit logs', { error: String(error) });
      next(error);
    }
  };

  /**
   * System Error Logs view for Super Admins
   */
  errorLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = extractPaginationParams(req, 25);
      const levelFilter = req.query.level as string | undefined;

      const [errorLogs, total] = await Promise.all([
        ErrorLogModel.findRecent({
          level: levelFilter && levelFilter.trim() !== '' ? levelFilter : undefined,
          limit: params.limit,
          offset: params.offset,
        }),
        ErrorLogModel.count({
          level: levelFilter && levelFilter.trim() !== '' ? levelFilter : undefined,
        }),
      ]);

      const pagination = calculatePagination(total, params, req);

      res.render('pages/admin/errorLogs', {
        title: 'System Error Diagnostics',
        errorLogs,
        pagination,
        selectedLevel: levelFilter || '',
        currentPath: req.originalUrl,
      });
    } catch (error) {
      auditLogger.error('Failed to load error logs', { error: String(error) });
      next(error);
    }
  };
}

export default new AuditController();
