import { config } from './config.js';
import { createPool } from './shared/db.js';
import { migrate } from '../scripts/migrate.js';
import { createApp } from './app.js';
import { createMqttWorker } from './modules/mqtt/worker.js';
import { once } from 'node:events';

const pool = createPool();
let worker;
let server;
try {
  await migrate(pool);
  worker = createMqttWorker(pool, config.mqtt);
  const app = createApp(pool, worker);
  server = app.listen(config.port, config.host, () => {
    console.log(`NorthBridge dashboard: http://${config.host}:${config.port}`);
  });
  await once(server, 'listening');
  worker.start();
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    // Start the force-exit deadline before any potentially blocked cleanup.
    setTimeout(() => process.exit(0), 5000).unref();
    await worker.stop();
    server.close(async () => { await pool.end(); process.exit(0); });
  }
  const stopSafely = () => shutdown().catch(() => process.exit(1));
  process.once('SIGINT', stopSafely);
  process.once('SIGTERM', stopSafely);
  server.on('error', (error) => { console.error('Server error:', error.code); stopSafely(); });
} catch {
  console.error('Startup failed. Check PostgreSQL and your local .env configuration.');
  if (server) server.close(() => {});
  if (worker) await worker.stop().catch(() => {});
  await pool.end();
  process.exitCode = 1;
}
