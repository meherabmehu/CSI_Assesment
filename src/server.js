import { config } from './config.js';
import { createPool } from './shared/db.js';
import { migrate } from '../scripts/migrate.js';
import { createApp } from './app.js';

const pool = createPool();
try {
  await migrate(pool);
  const app = createApp(pool);
  const server = app.listen(config.port, config.host, () => {
    console.log(`NorthBridge dashboard: http://${config.host}:${config.port}`);
  });
  async function shutdown() {
    server.close(async () => { await pool.end(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', (error) => { console.error('Server could not start:', error.code); process.exitCode = 1; pool.end(); });
} catch {
  console.error('Startup failed. Check PostgreSQL and your local .env configuration.');
  await pool.end();
  process.exitCode = 1;
}
