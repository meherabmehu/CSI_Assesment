export async function getSummary(client, sourceId = null) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COALESCE(SUM(CASE WHEN e.type = 'COUNT' THEN e.quantity ELSE -target.quantity END), 0)
       FROM production_events e LEFT JOIN production_events target ON target.event_id = e.target_event_id
       WHERE e.status = 'ACCEPTED' AND ($1::text IS NULL OR e.source_id = $1)) AS net_total,
      (SELECT count(*) FROM production_events WHERE status = 'ACCEPTED' AND ($1::text IS NULL OR source_id = $1)) AS processed_events,
      (SELECT count(*) FROM production_events WHERE status = 'ACCEPTED' AND acknowledged_at IS NULL AND ($1::text IS NULL OR source_id = $1)) AS pending_ack,
      (SELECT count(*) FROM production_events WHERE status = 'PENDING_REFERENCE' AND ($1::text IS NULL OR source_id = $1)) AS unresolved,
      (SELECT count(*) FROM submission_attempts WHERE classification = 'DUPLICATE' AND ($1::text IS NULL OR source_id = $1)) AS duplicates,
      (SELECT count(*) FROM submission_attempts WHERE classification = 'CONFLICT' AND ($1::text IS NULL OR source_id = $1)) AS conflicts
  `, [sourceId]);
  return Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key, Number(value)]));
}

export async function getPending(client, sourceId = null) {
  const { rows } = await client.query(`SELECT event_id, source_id, type, quantity, target_event_id,
    event_time, received_at, completed_at, status, acknowledged_at
    FROM production_events WHERE status = 'ACCEPTED' AND acknowledged_at IS NULL
    AND ($1::text IS NULL OR source_id = $1) ORDER BY ingestion_order DESC LIMIT 200`, [sourceId]);
  return rows;
}

export async function getExceptions(client, sourceId = null) {
  const { rows } = await client.query(`
    SELECT * FROM (
      SELECT 'event-' || e.event_id AS record_id, e.event_id, e.source_id, e.type, e.quantity,
        e.target_event_id, e.status, e.reason, e.received_at
      FROM production_events e
      WHERE (e.status = 'PENDING_REFERENCE' OR (e.status = 'REJECTED' AND EXISTS (
        SELECT 1 FROM submission_attempts a WHERE a.event_id = e.event_id AND a.classification = 'PENDING_REFERENCE')))
        AND ($1::text IS NULL OR e.source_id = $1)
      UNION ALL
      SELECT 'attempt-' || a.id::text, a.event_id, a.source_id,
        a.raw_payload->>'type', NULL::integer, a.raw_payload->>'target_event_id', a.classification, a.error, a.received_at
      FROM submission_attempts a WHERE a.classification IN ('REJECTED', 'CONFLICT')
        AND ($1::text IS NULL OR a.source_id = $1)
    ) exceptions ORDER BY received_at DESC LIMIT 200`, [sourceId]);
  return rows;
}

export async function getHistory(client, sourceId = null) {
  const { rows } = await client.query(`SELECT id, event_id, source_id, raw_payload, raw_payload_text, classification AS status,
    error AS reason, transport, challenge_id, received_at FROM submission_attempts
    WHERE ($1::text IS NULL OR source_id = $1) ORDER BY id DESC LIMIT 200`, [sourceId]);
  return rows;
}
