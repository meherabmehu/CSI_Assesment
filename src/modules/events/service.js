import { withTransaction } from '../../shared/db.js';
import { canonicalJson } from '../../shared/contracts.js';
import { notifyChanges } from '../../shared/domain-events.js';
import { validateEvent } from './validation.js';
import { findEvent, recordAttempt } from './repository.js';
import { processCount } from './count.js';

export async function processEventsInTransaction(client, items, context = {}, notifications = []) {
  const results = [];
  for (const raw of items) {
    const { event, error } = validateEvent(raw);
    let result;
    if (error) {
      result = { event_id: typeof raw?.event_id === 'string' ? raw.event_id : null, status: 'REJECTED', message: error };
    } else {
      const original = await findEvent(client, event.event_id);
      if (original) {
        const identical = canonicalJson(original.normalized_payload) === canonicalJson(event);
        result = {
          event_id: event.event_id,
          status: identical ? 'DUPLICATE' : 'CONFLICT',
          message: identical ? 'This event has already been submitted; no production was added.'
            : 'This event ID already belongs to different data; the original was preserved.',
        };
      } else if (event.type === 'COUNT') {
        result = await processCount(client, event, notifications);
      } else {
        result = { event_id: event.event_id, status: 'REJECTED', message: 'VOID processing is not available yet.' };
      }
    }
    await recordAttempt(client, raw, result, context);
    results.push(result);
  }
  return results;
}

export async function processEvents(pool, items, context = {}) {
  const notifications = [];
  const results = await withTransaction(pool, (client) => processEventsInTransaction(client, items, context, notifications));
  notifyChanges(notifications);
  return { results };
}
