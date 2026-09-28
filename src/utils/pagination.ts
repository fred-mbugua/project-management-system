// ══════════════════════════════════════════════════════════════════════
// Pagination & Date Filter Utilities
// Standardized list pagination, date range filtering, and URL query builder
// ══════════════════════════════════════════════════════════════════════

import { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
  search: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  category?: string | null;
}

export interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  hasPrev: boolean;
  hasNext: boolean;
  pages: number[];
  query: Record<string, string>;
  baseUrl: string;
}

/**
 * Extract standardized pagination and filter params from request query
 */
export function extractPaginationParams(req: Request, defaultLimit: number = 10): PaginationParams {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || defaultLimit), 10) || defaultLimit));
  const offset = (page - 1) * limit;

  const search = typeof req.query.q === 'string'
    ? req.query.q.trim()
    : typeof req.query.search === 'string'
    ? req.query.search.trim()
    : '';

  const startDate = typeof req.query.startDate === 'string' && req.query.startDate.trim()
    ? req.query.startDate.trim()
    : typeof req.query.from === 'string' && req.query.from.trim()
    ? req.query.from.trim()
    : null;

  const endDate = typeof req.query.endDate === 'string' && req.query.endDate.trim()
    ? req.query.endDate.trim()
    : typeof req.query.to === 'string' && req.query.to.trim()
    ? req.query.to.trim()
    : null;

  const status = typeof req.query.status === 'string' && req.query.status.trim()
    ? req.query.status.trim()
    : null;

  const category = typeof req.query.category === 'string' && req.query.category.trim()
    ? req.query.category.trim()
    : null;

  return {
    page,
    limit,
    offset,
    search,
    startDate,
    endDate,
    status,
    category,
  };
}

/**
 * Compute pagination metadata for views
 */
export function calculatePagination(
  total: number,
  params: PaginationParams,
  req: Request
): PaginationData {
  const totalPages = Math.max(1, Math.ceil(total / params.limit));
  const currentPage = Math.min(params.page, totalPages);
  const startIndex = total === 0 ? 0 : (currentPage - 1) * params.limit + 1;
  const endIndex = Math.min(currentPage * params.limit, total);

  // Generate page numbers with sliding window of up to 5 numbers
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = startPage + maxButtons - 1;

  if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  const pages: number[] = [];
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  // Preserve existing query params (excluding page)
  const queryObj: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== 'page' && typeof value === 'string' && value.trim()) {
      queryObj[key] = value.trim();
    }
  }

  return {
    page: currentPage,
    limit: params.limit,
    total,
    totalPages,
    startIndex,
    endIndex,
    hasPrev: currentPage > 1,
    hasNext: currentPage < totalPages,
    pages,
    query: queryObj,
    baseUrl: req.baseUrl || req.path,
  };
}
