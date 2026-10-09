import { insertEvent } from './repository.js';
import { recordAudit } from '../audit/service.js';

export async function processCount(client, event, notifications) {
  await insertEvent(client, event, 'ACCEPTED');
  await recordAudit(client, event.event_id, 'COUNT_ACCEPTED', { quantity: event.quantity });
  notifications.push({ type: 'EVENT_ACCEPTED', event_id: event.event_id });
  return { event_id: event.event_id, status: 'ACCEPTED', message: 'Production count recorded.' };
}
