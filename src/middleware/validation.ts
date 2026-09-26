// ══════════════════════════════════════════════════════════════════════
// Validation Middleware - Zod Schema Validation Dispatcher
// ══════════════════════════════════════════════════════════════════════

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import logger from '../utils/logger';

const validationLogger = logger.child('Validation');

/**
 * Validate request body against a Zod schema.
 * On failure: flashes errors for form submissions, returns JSON errors for API calls.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = schema.safeParse(req.body);

      if (!result.success) {
        const errors = formatZodErrors(result.error);

        validationLogger.debug('Validation failed', {
          path: req.path,
          errors,
        });

        // API request - return JSON
        if (req.path.startsWith('/api/') || req.headers.accept?.includes('application/json')) {
          res.status(422).json({
            error: 'Validation failed',
            details: errors,
          });
          return;
        }

        // Browser request - flash errors and redirect back
        req.flash('error', errors.join('. '));
        res.locals.validationErrors = errors;
        res.locals.formData = req.body;
        res.redirect('back');
        return;
      }

      // Replace body with parsed/transformed data
      req.body = result.data;
      next();
    } catch (error) {
      validationLogger.error('Validation middleware error', { error: String(error) });
      next(error);
    }
  };
}

/**
 * Validate request query parameters against a Zod schema.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = schema.safeParse(req.query);

      if (!result.success) {
        const errors = formatZodErrors(result.error);

        if (req.path.startsWith('/api/')) {
          res.status(422).json({ error: 'Invalid query parameters', details: errors });
          return;
        }

        req.flash('error', 'Invalid request parameters.');
        res.redirect('back');
        return;
      }

      req.query = result.data as any;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate request URL parameters against a Zod schema.
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = schema.safeParse(req.params);

      if (!result.success) {
        res.status(400).json({ error: 'Invalid URL parameters' });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Format Zod validation errors into user-friendly strings.
 */
function formatZodErrors(error: ZodError): string[] {
  const issues = (error as any).issues || (error as any).errors || [];
  return issues.map((err: any) => {
    const field = Array.isArray(err.path) ? err.path.join('.') : '';
    const message = err.message;
    return field ? `${field}: ${message}` : message;
  });
}
