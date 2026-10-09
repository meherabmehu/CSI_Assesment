export async function recordAudit(client, eventId, action, details = {}) {
  await client.query(
    'INSERT INTO audit_log(event_id, action, details) VALUES ($1, $2, $3)',
    [eventId, action, details],
  );
}
