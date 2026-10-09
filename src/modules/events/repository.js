export async function findEvent(client, eventId) {
  const result = await client.query('SELECT * FROM production_events WHERE event_id = $1', [eventId]);
  return result.rows[0] || null;
}

export async function insertEvent(client, event, status, reason = null) {
  await client.query(
    'INSERT INTO production_sources(source_id, display_name) VALUES ($1, $1) ON CONFLICT DO NOTHING',
    [event.source_id],
  );
  const { rows } = await client.query(`
    INSERT INTO production_events(event_id, source_id, type, quantity, target_event_id,
      event_time, status, reason, normalized_payload, completed_at, acknowledged_at, acknowledgement_method)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
      CASE WHEN $7 = 'ACCEPTED' THEN clock_timestamp() ELSE NULL END,
      CASE WHEN $3 = 'VOID' AND $7 = 'ACCEPTED' THEN clock_timestamp() ELSE NULL END,
      CASE WHEN $3 = 'VOID' AND $7 = 'ACCEPTED' THEN 'AUTOMATIC' ELSE NULL END)
    RETURNING *`,
  [event.event_id, event.source_id, event.type, event.quantity, event.target_event_id, event.event_time, status, reason, event]);
  return rows[0];
}

export async function recordAttempt(client, raw, result, context) {
  const usefulString = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
  await client.query(`
    INSERT INTO submission_attempts(raw_payload, source_id, event_id, classification, error, transport, challenge_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [JSON.stringify(raw), usefulString(raw?.source_id), usefulString(raw?.event_id), result.status,
    ['REJECTED', 'CONFLICT'].includes(result.status) ? result.message : null,
    context.transport || 'REST', context.challengeId || null]);
}
