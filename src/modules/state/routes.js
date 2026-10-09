import { Router } from 'express';
import { getState } from './service.js';

export function readSource(query) {
  if (query.source_id === undefined) return null;
  if (typeof query.source_id !== 'string' || !query.source_id.trim() || query.source_id.trim().length > 128) {
    const error = new Error('source_id must be a non-empty string, up to 128 characters.');
    error.status = 400;
    throw error;
  }
  return query.source_id.trim();
}

export function stateRoutes(pool) {
  const router = Router();
  router.get('/', async (req, res) => {
    const view = req.query.view || 'summary';
    if (!['summary', 'pending', 'exceptions', 'history'].includes(view)) {
      return res.status(400).json({ error: 'view must be summary, pending, exceptions or history.' });
    }
    res.json(await getState(pool, view, readSource(req.query)));
  });
  return router;
}
