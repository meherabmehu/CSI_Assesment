import { config } from '../src/config.js';
import { createPool } from '../src/shared/db.js';
import { migrate } from './migrate.js';

const name = config.database.database;
if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('Use a lowercase PostgreSQL database name with letters, digits and underscores.');
const admin = createPool({ database: 'postgres' });
let pool;
try {
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE ${name}`);
  pool = createPool();
  await migrate(pool);
  console.log(`Database ${name} and its tables are ready.`);
} catch {
  console.error('Database setup failed. Check PostgreSQL, .env credentials and permission to create a database.');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
  await admin.end();
}
