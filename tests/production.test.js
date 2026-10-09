import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { testDatabase, count, voidEvent, challenge } from './helpers.js';
import { processEvents, processEventsInTransaction } from '../src/modules/events/service.js';
import { acknowledgeEvents } from '../src/modules/ack/service.js';
import { getState } from '../src/modules/state/service.js';
import { handleChallenge } from '../src/modules/mqtt/service.js';
import { validateEvent } from '../src/modules/events/validation.js';
import { withTransaction, createPool } from '../src/shared/db.js';
import { domainEvents } from '../src/shared/domain-events.js';
import { createApp } from '../src/app.js';

let db;
let server;
let base;
before(async () => {
  db = await testDatabase();
  server = createApp(db.pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => db.reset());
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); if (db) await db.close(); });
const summary = () => getState(db.pool);
const send = (items) => processEvents(db.pool, items);
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('COUNT adds production and creates a pending supervisor review', async () => {
  const result = await send([count()]);
  assert.equal(result.results[0].status, 'ACCEPTED');
  assert.deepEqual(await summary(), { net_total: 5, processed_events: 1, pending_ack: 1, unresolved: 0, duplicates: 0, conflicts: 0 });
});

test('an identical retry is stored without double counting', async () => {
  await send([count(), count()]);
  assert.equal((await summary()).net_total, 5);
  assert.equal((await summary()).duplicates, 1);
  assert.equal((await db.pool.query('SELECT count(*) FROM submission_attempts')).rows[0].count, '2');
});

test('normalization treats optional nulls, whitespace and timezone equivalents identically', async () => {
  await send([count()]);
  const retry = { ...count(), source_id: ' LINE-01 ', event_id: ' EV-101 ', target_event_id: null, event_time: '2026-10-09T16:30:00+06:00', ignored: true };
  assert.equal((await send([retry])).results[0].status, 'DUPLICATE');
});

test('conflicting data preserves the original event and total', async () => {
  await send([count()]);
  assert.equal((await send([count('EV-101', 12)])).results[0].status, 'CONFLICT');
  assert.equal((await summary()).net_total, 5);
  assert.equal((await summary()).conflicts, 1);
});

test('ISO fractional timestamps retain precision when classifying retries', async () => {
  const event = { ...count(), event_time: '2026-10-09T10:30:00.123456Z' };
  await send([event]);
  const equivalent = { ...event, event_time: '2026-10-09T16:30:00.123456000+06:00' };
  assert.equal((await send([equivalent])).results[0].status, 'DUPLICATE');
  assert.equal((await send([{ ...event, event_time: '2026-10-09T10:30:00.123457Z' }])).results[0].status, 'CONFLICT');
});

test('events stored with the older millisecond normalization remain duplicate-safe after upgrades', async () => {
  await send([count()]);
  await db.pool.query("UPDATE production_events SET normalized_payload = jsonb_set(normalized_payload, '{event_time}', '\"2026-10-09T10:30:00.000Z\"') WHERE event_id = 'EV-101'");
  assert.equal((await send([count()])).results[0].status, 'DUPLICATE');
  assert.equal((await summary()).net_total, 5);
});

test('a NUL character in an invalid item cannot roll back valid batch siblings', async () => {
  const result = await send([count('GOOD-A'), count('BAD\u0000ID'), count('GOOD-B')]);
  assert.deepEqual(result.results.map((item) => item.status), ['ACCEPTED', 'REJECTED', 'ACCEPTED']);
  assert.equal((await summary()).net_total, 10);
  assert.equal((await db.pool.query('SELECT count(*) FROM submission_attempts')).rows[0].count, '3');
});

test('unsupported JSON text in metadata is rejected and its original submission is preserved', async () => {
  const raw = { ...count('BAD-TEXT'), note: '\u0000\ud800' };
  const result = await send([raw, count('GOOD')]);
  assert.deepEqual(result.results.map((item) => item.status), ['REJECTED', 'ACCEPTED']);
  const row = (await db.pool.query('SELECT raw_payload_text FROM submission_attempts WHERE classification = $1', ['REJECTED'])).rows[0];
  assert.equal(row.raw_payload_text, JSON.stringify(raw));
});

test('deeply nested rejected metadata remains loggable without aborting the batch', async () => {
  let note = 'deep';
  for (let i = 0; i < 200; i++) note = { child: note };
  const raw = { ...count('DEEP'), note };
  const result = await send([raw, count('GOOD')]);
  assert.deepEqual(result.results.map((item) => item.status), ['REJECTED', 'ACCEPTED']);
  const row = (await db.pool.query('SELECT raw_payload_text FROM submission_attempts WHERE event_id = $1', ['DEEP'])).rows[0];
  assert.equal(row.raw_payload_text, JSON.stringify(raw));
});

test('oversized source IDs cannot break the attempt-history index or valid siblings', async () => {
  const source = Array.from({ length: 300 }, (_, i) => `${i}-${Math.random().toString(36)}`).join('');
  const result = await send([count('LONG-SOURCE', 5, source), count('GOOD')]);
  assert.deepEqual(result.results.map((item) => item.status), ['REJECTED', 'ACCEPTED']);
  assert.equal((await summary()).net_total, 5);
});

test('event IDs are globally unique and conflicts filter by submitted source', async () => {
  await send([count(), count('EV-101', 5, 'LINE-02')]);
  const line2 = await getState(db.pool, 'summary', 'LINE-02');
  assert.equal(line2.conflicts, 1);
  assert.equal(line2.net_total, 0);
});

test('VOID before COUNT resolves automatically and retains both records', async () => {
  assert.equal((await send([voidEvent()])).results[0].status, 'PENDING_REFERENCE');
  assert.equal((await summary()).unresolved, 1);
  await send([count()]);
  assert.deepEqual(await summary(), { net_total: 0, processed_events: 2, pending_ack: 1, unresolved: 0, duplicates: 0, conflicts: 0 });
  const events = (await db.pool.query('SELECT * FROM production_events')).rows;
  assert.equal(events.length, 2);
  assert.equal(events.find((event) => event.type === 'VOID').acknowledgement_method, 'AUTOMATIC');
});

test('the first stored pending VOID wins even when its ID sorts last', async () => {
  await send([voidEvent('Z-FIRST'), voidEvent('A-SECOND'), count()]);
  const rows = (await db.pool.query("SELECT event_id, status FROM production_events WHERE type = 'VOID' ORDER BY ingestion_order")).rows;
  assert.deepEqual(rows, [{ event_id: 'Z-FIRST', status: 'ACCEPTED' }, { event_id: 'A-SECOND', status: 'REJECTED' }]);
  assert.equal((await summary()).net_total, 0);
  assert.equal((await getState(db.pool, 'exceptions')).events[0].status, 'REJECTED');
});

test('a COUNT can be reversed only once', async () => {
  await send([count(), voidEvent()]);
  assert.equal((await send([voidEvent('SECOND-VOID')])).results[0].status, 'REJECTED');
  assert.equal((await summary()).net_total, 0);
});

test('a VOID cannot reverse a COUNT on another production line', async () => {
  await send([count()]);
  assert.equal((await send([voidEvent('WRONG-LINE', 'EV-101', 'LINE-02')])).results[0].status, 'REJECTED');
  assert.equal((await summary()).net_total, 5);
});

test('a pending wrong-line VOID is rejected when its target arrives', async () => {
  await send([voidEvent('WRONG-LINE', 'EV-101', 'LINE-02'), count()]);
  assert.equal((await summary()).unresolved, 0);
  assert.equal((await summary()).net_total, 5);
  assert.match((await getState(db.pool, 'exceptions')).events[0].reason, /same source/);
});

test('a pending VOID is rejected if its eventual target is a VOID', async () => {
  await send([voidEvent('FIRST', 'SECOND'), voidEvent('SECOND', 'MISSING')]);
  const first = (await db.pool.query("SELECT status FROM production_events WHERE event_id = 'FIRST'")).rows[0];
  assert.equal(first.status, 'REJECTED');
  assert.equal((await summary()).unresolved, 1);
});

test('acknowledgement is repeat safe including duplicate IDs in one request', async () => {
  await send([count()]);
  const result = await acknowledgeEvents(db.pool, ['EV-101', 'EV-101']);
  assert.deepEqual(result.results.map((item) => item.status), ['ACKED', 'ALREADY_ACKED']);
  assert.equal((await summary()).pending_ack, 0);
  assert.equal((await summary()).net_total, 5);
});

test('unresolved, rejected and missing acknowledgements are classified correctly', async () => {
  await send([voidEvent(), count('TARGET'), voidEvent('BAD', 'TARGET', 'LINE-02')]);
  const result = await acknowledgeEvents(db.pool, ['EV-VOID', 'BAD', 'UNKNOWN']);
  assert.deepEqual(result.results.map((item) => item.status), ['NOT_READY', 'NOT_READY', 'NOT_FOUND']);
});

test('acknowledging a COUNT does not prevent a later valid VOID', async () => {
  await send([count()]);
  await acknowledgeEvents(db.pool, ['EV-101']);
  await send([voidEvent()]);
  assert.equal((await summary()).net_total, 0);
  assert.equal((await acknowledgeEvents(db.pool, ['EV-VOID'])).results[0].status, 'ALREADY_ACKED');
});

test('mixed batches preserve order and commit valid items despite invalid siblings', async () => {
  const result = await send([count('GOOD-A', 2), null, count('BAD', -1), count('GOOD-B', 3)]);
  assert.deepEqual(result.results.map((item) => item.status), ['ACCEPTED', 'REJECTED', 'REJECTED', 'ACCEPTED']);
  assert.deepEqual(result.results.map((item) => item.event_id), ['GOOD-A', null, 'BAD', 'GOOD-B']);
  assert.equal((await summary()).net_total, 5);
  assert.equal((await db.pool.query('SELECT count(*) FROM submission_attempts')).rows[0].count, '4');
});

test('concurrent copies of a COUNT change production exactly once', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => send([count()])));
  assert.equal(results.filter((result) => result.results[0].status === 'ACCEPTED').length, 1);
  assert.equal((await summary()).duplicates, 7);
  assert.equal((await summary()).net_total, 5);
});

test('concurrent distinct VOID requests cannot double reverse a COUNT', async () => {
  await send([count()]);
  const results = await Promise.all([send([voidEvent('VOID-A')]), send([voidEvent('VOID-B')])]);
  assert.deepEqual(results.map((result) => result.results[0].status).sort(), ['ACCEPTED', 'REJECTED']);
  assert.equal((await summary()).net_total, 0);
});

test('an unexpected transaction failure rolls back events and attempt history together', async () => {
  await assert.rejects(withTransaction(db.pool, async (client) => {
    await processEventsInTransaction(client, [count()]);
    throw new Error('Simulated database failure');
  }));
  assert.equal((await summary()).net_total, 0);
  assert.equal((await db.pool.query('SELECT count(*) FROM submission_attempts')).rows[0].count, '0');
});

test('internal event callbacks observe committed data', async () => {
  let observed;
  const listener = () => { observed = summary(); };
  domainEvents.once('EVENT_ACCEPTED', listener);
  try {
    await send([count()]);
    assert.equal((await observed).net_total, 5);
  } finally { domainEvents.off('EVENT_ACCEPTED', listener); }
});

test('state survives closing and reopening a PostgreSQL pool', async () => {
  await send([count()]);
  const other = createPool({ database: db.database });
  try { assert.equal((await getState(other)).net_total, 5); }
  finally { await other.end(); }
});

test('invalid calendar dates, missing timezone, decimals and self-targets are rejected', () => {
  for (const bad of [
    { ...count(), event_time: '2026-02-31T10:00:00Z' },
    { ...count(), event_time: '2026-10-09T10:00:00' },
    count('DECIMAL', 1.5), { ...voidEvent(), target_event_id: 'EV-VOID' },
    { ...voidEvent(), quantity: 1 }, { ...count(), target_event_id: 'OTHER' },
  ]) assert.ok(validateEvent(bad).error);
});

test('unidentified rejected submissions appear only in unfiltered exceptions', async () => {
  await send([{}, count('BAD', -1)]);
  assert.equal((await getState(db.pool, 'exceptions')).events.length, 2);
  assert.equal((await getState(db.pool, 'exceptions', 'LINE-01')).events.length, 1);
});

test('MQTT challenges use the same COUNT logic as REST', async () => {
  const response = await handleChallenge(db.pool, challenge(), '08');
  assert.equal(response.status, 'COMPLETED');
  assert.equal(response.state.net_total, 5);
  assert.equal((await send([count()])).results[0].status, 'DUPLICATE');
});

test('repeated MQTT challenges return the exact stored response without new event attempts', async () => {
  const body = challenge();
  const first = await handleChallenge(db.pool, body, '08');
  await send([count('LATER', 9)]);
  const second = await handleChallenge(db.pool, body, '08');
  assert.deepEqual(second, first);
  assert.equal((await summary()).net_total, 14);
  assert.equal((await db.pool.query("SELECT count(*) FROM submission_attempts WHERE transport = 'MQTT'")).rows[0].count, '1');
});

test('concurrent MQTT retries process the original challenge once', async () => {
  const body = challenge();
  const responses = await Promise.all(Array.from({ length: 4 }, () => handleChallenge(db.pool, body, '08')));
  for (const response of responses) assert.deepEqual(response, responses[0]);
  assert.equal((await summary()).net_total, 5);
  assert.equal((await db.pool.query('SELECT count(*) FROM mqtt_challenges')).rows[0].count, '1');
});

test('changed challenge data fails without overwriting the original response', async () => {
  const body = challenge();
  const original = await handleChallenge(db.pool, body, '08');
  const conflict = await handleChallenge(db.pool, { ...body, events: [count('NEW', 10)] }, '08');
  assert.equal(conflict.error_code, 'CHALLENGE_CONFLICT');
  assert.equal((await summary()).net_total, 5);
  assert.deepEqual(await handleChallenge(db.pool, body, '08'), original);
});

test('expired and mismatched challenges are rejected before processing events', async () => {
  const expired = challenge([count()], { sent_at: new Date(Date.now() - 20000).toISOString(), expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await handleChallenge(db.pool, expired, '08')).error_code, 'CHALLENGE_EXPIRED');
  assert.equal((await handleChallenge(db.pool, challenge([count()], { challenge_id: 'CH-WRONG', candidate_id: 'OTHER' }), '08')).error_code, 'CANDIDATE_MISMATCH');
  assert.equal((await summary()).net_total, 0);
});

test('a stored MQTT response cannot bypass candidate validation after configuration changes', async () => {
  const body = challenge();
  await handleChallenge(db.pool, body, '08');
  const response = await handleChallenge(db.pool, body, '09');
  assert.equal(response.status, 'FAILED');
  assert.equal(response.error_code, 'CANDIDATE_MISMATCH');
  assert.equal(response.candidate_id, '09');
});

test('a mismatched candidate cannot reserve a legitimate challenge ID', async () => {
  const body = challenge();
  const wrong = await handleChallenge(db.pool, { ...body, candidate_id: 'OTHER' }, '08');
  assert.equal(wrong.error_code, 'CANDIDATE_MISMATCH');
  const legitimate = await handleChallenge(db.pool, body, '08');
  assert.equal(legitimate.status, 'COMPLETED');
  assert.equal(legitimate.state.net_total, 5);
});

test('MQTT can complete while an individual event is rejected', async () => {
  const response = await handleChallenge(db.pool, challenge([count('BAD', -1), count()]), '08');
  assert.equal(response.status, 'COMPLETED');
  assert.deepEqual(response.results.map((item) => item.status), ['REJECTED', 'ACCEPTED']);
  assert.equal(response.state.net_total, 5);
});

test('unsupported protocol and invalid MQTT metadata have stable error codes', async () => {
  assert.equal((await handleChallenge(db.pool, challenge([], { protocol_version: '2.0' }), '08')).error_code, 'UNSUPPORTED_PROTOCOL');
  assert.equal((await handleChallenge(db.pool, challenge([], { challenge_id: 'BAD-METADATA', command: 'UNKNOWN' }), '08')).error_code, 'VALIDATION_ERROR');
  assert.equal((await handleChallenge(db.pool, null, '08')).error_code, 'VALIDATION_ERROR');
});

test('REST returns 200 for mixed batches and 400 for non-event top-level JSON', async () => {
  const response = await post('/api/events', [count(), count('BAD', 0)]);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).results.map((item) => item.status), ['ACCEPTED', 'REJECTED']);
  assert.equal((await post('/api/events', 'not an event')).status, 400);
});

test('REST handles malformed JSON and invalid query/ACK input without exposing internals', async () => {
  const response = await fetch(base + '/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Invalid JSON/);
  assert.equal((await fetch(base + '/api/state?view=invalid')).status, 400);
  assert.equal((await fetch(base + '/api/state?source_id=')).status, 400);
  assert.equal((await post('/api/ack', { event_ids: [] })).status, 400);
  assert.equal((await post('/api/ack', { event_ids: ['BAD\u0000ID'] })).status, 400);
  assert.equal((await fetch(base + '/api/state?source_id=BAD%00ID')).status, 400);
});

test('dashboard and health endpoints return real database data', async () => {
  await send([count()]);
  const data = await (await fetch(base + '/api/dashboard')).json();
  assert.equal(data.summary.net_total, 5);
  assert.equal(data.pending.length, 1);
  assert.equal(data.history.length, 1);
  assert.equal((await (await fetch(base + '/api/health')).json()).database, 'connected');
});
