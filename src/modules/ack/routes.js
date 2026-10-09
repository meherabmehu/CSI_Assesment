import { Router } from 'express';
import { acknowledgeEvents } from './service.js';
import { validIdentifier } from '../../shared/json.js';

export function ackRoutes(pool) {
  const router = Router();
  router.post('/', async (req, res) => {
    const ids = req.body?.event_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 500
        || ids.some((id) => !validIdentifier(id))) {
      return res.status(400).json({ error: 'event_ids must contain 1 to 500 non-empty strings.' });
    }
    res.json(await acknowledgeEvents(pool, ids.map((id) => id.trim())));
  });
  return router;
}
