import { Router } from 'express';
import { isObject } from '../../shared/contracts.js';
import { processEvents } from './service.js';

export function eventRoutes(pool) {
  const router = Router();
  router.post('/', async (req, res) => {
    if (!isObject(req.body) && !Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Send an event object or an array of event objects.' });
    }
    const items = Array.isArray(req.body) ? req.body : [req.body];
    if (items.length > 500) return res.status(400).json({ error: 'A batch can contain at most 500 items.' });
    res.json(await processEvents(pool, items));
  });
  return router;
}
