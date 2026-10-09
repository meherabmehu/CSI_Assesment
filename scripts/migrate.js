import { readFile } from 'node:fs/promises';
import { createPool, withTransaction } from '../src/shared/db.js';

export async function migrate(pool) {
  const sql = await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  await withTransaction(pool, (client) => client.query(sql));
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).href) {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log('PostgreSQL tables are ready.');
  } catch {
    console.error('Database initialization failed. Check PostgreSQL and your local .env settings.');
    process.exitCode = 1;
  } finally { await pool.end(); }
}
