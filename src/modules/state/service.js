import { withTransaction } from '../../shared/db.js';
import { getSummary, getPending, getExceptions, getHistory } from './queries.js';

export async function getState(pool, view = 'summary', sourceId = null) {
  return withTransaction(pool, async (client) => {
    if (view === 'summary') return getSummary(client, sourceId);
    if (view === 'pending') return { events: await getPending(client, sourceId) };
    if (view === 'exceptions') return { events: await getExceptions(client, sourceId) };
    return { events: await getHistory(client, sourceId) };
  }, { readOnly: true });
}

export async function getDashboard(pool, sourceId = null) {
  return withTransaction(pool, async (client) => ({
    summary: await getSummary(client, sourceId),
    pending: await getPending(client, sourceId),
    exceptions: await getExceptions(client, sourceId),
    history: await getHistory(client, sourceId),
    sources: (await client.query('SELECT source_id, display_name FROM production_sources ORDER BY source_id')).rows,
  }), { readOnly: true });
}
