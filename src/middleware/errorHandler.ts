// ══════════════════════════════════════════════════════════════════════
// Global Error Handler Middleware
// Catches all unhandled errors and renders appropriate responses
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { ErrorLogModel } from '../models/errorLog.model';

const errorLogger = logger.child('ErrorHandler');

/**
 * Custom application error with HTTP status code.
 */
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/**
 * 404 Not Found handler - catches unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Resource not found' });
    return;
  }

  res.status(404).render('pages/errors/404', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
    layout: 'layouts/main',
  });
}

/**
 * Global error handler - catches all thrown/passed errors.
 */
export function globalErrorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'An unexpected error occurred. Please try again later.'
      : err.message;

  // Generate unique diagnostic reference ID
  const errorReference = 'ERR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

  // 1. Structured File & Console Logging
  errorLogger.error('Unhandled error', {
    errorReference,
    statusCode,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    tenantId: req.tenantId,
    ip: req.ip || req.headers['x-forwarded-for'],
  });

  // 2. Persistent Database Error Logging
  ErrorLogModel.create({
    tenantId: req.tenantId || req.user?.tenantId || null,
    userId: req.user?.id || null,
    level: statusCode >= 500 ? 'ERROR' : 'WARN',
    message: err.message || 'Unknown server error',
    stack: err.stack || null,
    path: req.path,
    method: req.method,
    statusCode,
    ipAddress: (req.ip || (req.headers['x-forwarded-for'] as string) || null)?.toString(),
    userAgent: (req.headers['user-agent'] || null)?.toString(),
    metadata: {
      errorReference,
      query: req.query,
      body: req.method !== 'GET' ? req.body : undefined,
    },
  }).catch((dbErr) => {
    errorLogger.warn('Failed to record error to error_logs table', { dbError: dbErr.message });
  });

  // API error response
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    res.status(statusCode).json({
      error: message,
      errorReference,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
    return;
  }

  // Browser error response
  res.status(statusCode).render('pages/errors/error', {
    title: `Error ${statusCode}`,
    statusCode,
    message,
    errorReference,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    layout: 'layouts/main',
  });
}

