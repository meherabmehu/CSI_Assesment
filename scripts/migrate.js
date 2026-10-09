import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPool, withTransaction } from '../src/shared/db.js';

export async function migrate(pool) {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  await withTransaction(pool, async (client) => {
    for (const name of files) {
      try { await client.query(await readFile(new URL(name, directory), 'utf8')); }
      catch (error) {
        // Filename is application-controlled; SQL and driver details can contain private data.
        console.error(`Migration failed: ${name}`);
        throw error;
      }
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log('PostgreSQL tables are ready.');
  } catch {
    console.error('Database initialization failed. Check PostgreSQL and your local .env settings.');
    process.exitCode = 1;
  } finally { await pool.end(); }
}
