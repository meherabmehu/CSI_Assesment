import { findEvent, insertEvent } from './repository.js';
import { recordAudit } from '../audit/service.js';

async function rejectionReason(client, event, target) {
  if (target.type !== 'COUNT' || target.status !== 'ACCEPTED') return 'VOID must target an accepted COUNT.';
  if (target.source_id !== event.source_id) return 'VOID and its COUNT must have the same source_id.';
  const applied = await client.query(
    "SELECT event_id FROM production_events WHERE type = 'VOID' AND status = 'ACCEPTED' AND target_event_id = $1",
    [target.event_id],
  );
  return applied.rowCount ? 'This COUNT has already been reversed by another VOID.' : null;
}

export async function processVoid(client, event, notifications) {
  const target = await findEvent(client, event.target_event_id);
  if (!target) {
    await insertEvent(client, event, 'PENDING_REFERENCE', 'Waiting for the target COUNT.');
    await recordAudit(client, event.event_id, 'VOID_PENDING', { target_event_id: event.target_event_id });
    return { event_id: event.event_id, status: 'PENDING_REFERENCE', message: 'Stored; waiting for its target COUNT.' };
  }
  const reason = await rejectionReason(client, event, target);
  await insertEvent(client, event, reason ? 'REJECTED' : 'ACCEPTED', reason);
  await recordAudit(client, event.event_id, reason ? 'VOID_REJECTED' : 'VOID_APPLIED', { target_event_id: target.event_id, reason });
  if (!reason) notifications.push({ type: 'EVENT_ACCEPTED', event_id: event.event_id });
  return {
    event_id: event.event_id, status: reason ? 'REJECTED' : 'ACCEPTED',
    message: reason || 'The target COUNT was reversed; the correction was automatically acknowledged.',
  };
}

export async function resolvePendingVoids(client, targetId, notifications) {
  const target = await findEvent(client, targetId);
  if (!target) return;
  const { rows } = await client.query(
    "SELECT * FROM production_events WHERE status = 'PENDING_REFERENCE' AND target_event_id = $1 ORDER BY received_at, event_id",
    [targetId],
  );
  for (const pending of rows) {
    const reason = await rejectionReason(client, pending, target);
    await client.query(`UPDATE production_events SET status = $2, reason = $3,
      completed_at = CASE WHEN $2 = 'ACCEPTED' THEN clock_timestamp() ELSE NULL END,
      acknowledged_at = CASE WHEN $2 = 'ACCEPTED' THEN clock_timestamp() ELSE NULL END,
      acknowledgement_method = CASE WHEN $2 = 'ACCEPTED' THEN 'AUTOMATIC' ELSE NULL END
      WHERE event_id = $1`, [pending.event_id, reason ? 'REJECTED' : 'ACCEPTED', reason]);
    await recordAudit(client, pending.event_id, reason ? 'VOID_REJECTED' : 'VOID_RESOLVED', { target_event_id: targetId, reason });
    notifications.push({ type: reason ? 'VOID_REJECTED' : 'VOID_RESOLVED', event_id: pending.event_id });
  }
}
