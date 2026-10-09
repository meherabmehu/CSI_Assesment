import { config } from './config.js';
import { createPool } from './shared/db.js';
import { migrate } from '../scripts/migrate.js';
import { createApp } from './app.js';
import { createMqttWorker } from './modules/mqtt/worker.js';
import { once } from 'node:events';
import { safeError } from './shared/errors.js';

const pool = createPool();
let worker;
let server;
let stage = 'database connectivity';
try {
  await pool.query('SELECT 1');
  stage = 'database migrations';
  await migrate(pool);
  stage = 'MQTT configuration';
  worker = createMqttWorker(pool, config.mqtt);
  const app = createApp(pool, worker);
  stage = 'HTTP binding';
  server = app.listen(config.port, config.host);
  await once(server, 'listening');
  console.log(`NorthBridge dashboard: http://${config.host}:${server.address().port}`);
  stage = 'MQTT startup';
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
} catch (error) {
  console.error(`Startup failed during ${stage}:`, safeError(error));
  if (server) server.close(() => {});
  if (worker) await worker.stop().catch(() => {});
  await pool.end();
  process.exitCode = 1;
}
