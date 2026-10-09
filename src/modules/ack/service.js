import { withTransaction } from '../../shared/db.js';
import { notifyChanges } from '../../shared/domain-events.js';
import { findEvent } from '../events/repository.js';
import { recordAudit } from '../audit/service.js';

export async function acknowledgeEvents(pool, ids) {
  const notifications = [];
  const results = await withTransaction(pool, async (client) => {
    const results = [];
    for (const id of ids) {
      const event = await findEvent(client, id);
      let status;
      if (!event) status = 'NOT_FOUND';
      else if (event.status !== 'ACCEPTED') status = 'NOT_READY';
      else if (event.acknowledged_at) status = 'ALREADY_ACKED';
      else {
        await client.query("UPDATE production_events SET acknowledged_at = clock_timestamp(), acknowledgement_method = 'MANUAL' WHERE event_id = $1", [id]);
        await recordAudit(client, id, 'EVENT_ACKNOWLEDGED');
        notifications.push({ type: 'EVENT_ACKNOWLEDGED', event_id: id });
        status = 'ACKED';
      }
      results.push({ event_id: id, status });
    }
    return results;
  });
  notifyChanges(notifications);
  return { results };
}
