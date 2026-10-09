import { isObject, parseTimestamp } from '../../shared/contracts.js';
import { inspectJson, validIdentifier } from '../../shared/json.js';

export function validateEvent(input) {
  if (!isObject(input)) return { error: 'Each event must be a JSON object.' };
  const jsonError = inspectJson(input);
  if (jsonError) return { error: jsonError };
  if (!validIdentifier(input.source_id)) return { error: 'source_id must be a non-empty string, up to 128 characters.' };
  if (!validIdentifier(input.event_id)) return { error: 'event_id must be a non-empty string, up to 128 characters.' };
  if (!['COUNT', 'VOID'].includes(input.type)) return { error: 'type must be exactly COUNT or VOID.' };
  const eventTime = parseTimestamp(input.event_time);
  if (!eventTime) return { error: 'event_time must be a valid ISO 8601 timestamp with a timezone.' };

  if (input.type === 'COUNT') {
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 500) {
      return { error: 'COUNT quantity must be an integer from 1 to 500, inclusive.' };
    }
    if (input.target_event_id != null) return { error: 'COUNT must not specify target_event_id.' };
  } else {
    if (input.quantity != null) return { error: 'VOID quantity must be null or omitted.' };
    if (!validIdentifier(input.target_event_id)) return { error: 'VOID requires a non-empty target_event_id.' };
    if (input.event_id.trim() === input.target_event_id.trim()) return { error: 'A VOID cannot target itself.' };
  }

  return { event: {
    source_id: input.source_id.trim(),
    event_id: input.event_id.trim(),
    type: input.type,
    quantity: input.type === 'COUNT' ? input.quantity : null,
    target_event_id: input.type === 'VOID' ? input.target_event_id.trim() : null,
    event_time: eventTime,
  } };
}
