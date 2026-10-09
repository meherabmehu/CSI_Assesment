import express from 'express';
import { fileURLToPath } from 'node:url';
import { eventRoutes } from './modules/events/routes.js';
import { ackRoutes } from './modules/ack/routes.js';
import { stateRoutes, readSource } from './modules/state/routes.js';
import { getDashboard } from './modules/state/service.js';

export function createApp(pool, mqttMonitor = null) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb', strict: false }));
  app.use('/api/events', eventRoutes(pool));
  app.use('/api/ack', ackRoutes(pool));
  app.use('/api/state', stateRoutes(pool));
  app.get('/api/dashboard', async (req, res) => {
    const data = await getDashboard(pool, readSource(req.query));
    data.mqtt = mqttMonitor ? await mqttMonitor.getStatus() : { enabled: false, connected: false, state: 'DISABLED', challenges: [] };
    res.json(data);
  });
  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  });
  app.use(express.static(fileURLToPath(new URL('../frontend', import.meta.url))));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 400 ? 400 : error.type === 'entity.too.large' ? 413 : 500;
    const message = error.type === 'entity.parse.failed' ? 'Invalid JSON. Check commas, quotes and brackets.'
      : status === 400 ? error.message
        : status === 413 ? 'The request is larger than 1 MB.'
          : 'The request could not be completed. Check the database connection and try again.';
    if (status === 500) console.error('API request failed:', error.code || 'INTERNAL_ERROR');
    res.status(status).json({ error: message });
  });
  return app;
}
