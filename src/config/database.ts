// ══════════════════════════════════════════════════════════════════════
// Database Configuration - Native PostgreSQL Client Pool (node-postgres)
// Pure raw PSQL query execution with transaction management
// ══════════════════════════════════════════════════════════════════════

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import appConfig from './app';
import logger from '../utils/logger';

const dbLogger = logger.child('Database');

// Clean connection URL to strip Prisma-specific query params like ?schema=public if present
function parseDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('schema');
    return parsed.toString();
  } catch {
    return url;
  }
}

export const pool = new Pool({
  connectionString: parseDatabaseUrl(appConfig.databaseUrl),
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 5000, // Return an error after 5s if connection cannot be established
});

// Handle idle client errors so the server process does not exit unexpectedly
pool.on('error', (err) => {
  dbLogger.error('Unexpected error on idle PostgreSQL client', { error: err.message });
});

/**
 * Execute a parameterized query using a pooled connection.
 * Automatic timing and debug logging in development environment.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (appConfig.nodeEnv === 'development') {
      dbLogger.debug('Executed query', {
        text: text.replace(/\s+/g, ' ').trim().substring(0, 150),
        duration: `${duration}ms`,
        rows: result.rowCount,
      });
    }
    return result;
  } catch (error: any) {
    dbLogger.error('Database query error', {
      text: text.replace(/\s+/g, ' ').trim().substring(0, 200),
      error: error.message,
    });
    throw error;
  }
}

/**
 * Acquire a single dedicated client from the connection pool.
 * Caller MUST call client.release() when finished.
 */
export async function getClient(): Promise<PoolClient> {
  return await pool.connect();
}

/**
 * Execute a set of database operations within an isolated transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Test connectivity to PostgreSQL server.
 */
export async function testConnection(): Promise<boolean> {
  try {
    const res = await query('SELECT NOW() as current_time');
    dbLogger.info('PostgreSQL connected successfully', { timestamp: res.rows[0].current_time });
    return true;
  } catch (err: any) {
    dbLogger.error('PostgreSQL connection check failed', { error: err.message });
    return false;
  }
}

export default pool;
