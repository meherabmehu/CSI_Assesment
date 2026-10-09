import pg from 'pg';
import { config } from '../config.js';
import { safeError } from './errors.js';

export function createPool(overrides = {}) {
  const pool = new pg.Pool({ ...config.database, ...overrides });
  pool.on('error', (error) => console.error('Idle database connection failed:', safeError(error)));
  return pool;
}

// One transaction-wide write lock is deliberately simple for this small factory.
// It protects concurrent event retries, target resolution, ACKs and challenges.
export async function withTransaction(pool, work, { readOnly = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    if (!readOnly) await client.query('SELECT pg_advisory_xact_lock(7030101)');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
