// ══════════════════════════════════════════════════════════════════════
// Action Log Service
// Standardized User & System Action Recording across all modules
// ══════════════════════════════════════════════════════════════════════

import { Request } from 'express';
import { AuditLogModel } from '../models/auditLog.model';
import { AuditAction } from '../models/types';
import logger from '../utils/logger';

const actionLogger = logger.child('ActionLog');

export interface RecordActionInput {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  description: string;
  metadata?: Record<string, any>;
}

export class ActionLogService {
  /**
   * Record a user or system action into the audit trail.
   * Context (tenantId, userId, ipAddress, userAgent) is automatically pulled from Request.
   */
  static async record(req: Request, input: RecordActionInput): Promise<void> {
    try {
      const tenantId = req.tenantId || req.user?.tenantId || null;
      const userId = req.user?.id || null;
      const ipAddress = (req.ip || (req.headers['x-forwarded-for'] as string) || null)?.toString();
      const userAgent = (req.headers['user-agent'] || null)?.toString();

      await AuditLogModel.create({
        tenantId,
        userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId || null,
        description: input.description,
        ipAddress,
        userAgent,
        metadata: input.metadata || null,
      });

      actionLogger.info(`[Action Logged] ${input.action} on ${input.entityType}`, {
        tenantId,
        userId,
        entityId: input.entityId,
        description: input.description,
      });
    } catch (err: any) {
      // Non-blocking: audit recording failure should never fail the user's primary action
      actionLogger.warn('Failed to record action log entry', { error: err.message, input });
    }
  }

  /**
   * Fetch action logs with user details and pagination
   */
  static async getLogs(options: {
    tenantId?: string | null;
    action?: string;
    limit?: number;
    offset?: number;
  }) {
    const [logs, total] = await Promise.all([
      AuditLogModel.findWithUser(options),
      AuditLogModel.count({ tenantId: options.tenantId, action: options.action }),
    ]);

    return { logs, total };
  }
}

export default ActionLogService;
