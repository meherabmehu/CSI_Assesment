import { config } from './config.js';
import { createPool } from './shared/db.js';
import { migrate } from '../scripts/migrate.js';
import { createApp } from './app.js';
import { createMqttWorker } from './modules/mqtt/worker.js';

const pool = createPool();
try {
  await migrate(pool);
  const worker = createMqttWorker(pool, config.mqtt);
  const app = createApp(pool, worker);
  const server = app.listen(config.port, config.host, () => {
    console.log(`NorthBridge dashboard: http://${config.host}:${config.port}`);
  });
  worker.start();
  async function shutdown() {
    await worker.stop();
    server.close(async () => { await pool.end(); process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', async (error) => { console.error('Server could not start:', error.code); process.exitCode = 1; await worker.stop(); await pool.end(); });
} catch {
  console.error('Startup failed. Check PostgreSQL and your local .env configuration.');
  await pool.end();
  process.exitCode = 1;
}
