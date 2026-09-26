// ══════════════════════════════════════════════════════════════════════
// Global Error Handler Middleware
// Catches all unhandled errors and renders appropriate responses
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

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

  errorLogger.error('Unhandled error', {
    statusCode,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    tenantId: req.tenantId,
  });

  // API error response
  if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
    res.status(statusCode).json({
      error: message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
    return;
  }

  // Browser error response
  res.status(statusCode).render('pages/errors/error', {
    title: `Error ${statusCode}`,
    statusCode,
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    layout: 'layouts/main',
  });
}
