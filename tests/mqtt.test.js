import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { testDatabase, challenge, count, waitFor } from './helpers.js';
import { createMqttWorker } from '../src/modules/mqtt/worker.js';
import { handleChallenge } from '../src/modules/mqtt/service.js';
import { exchangeChallenge } from '../src/modules/mqtt/exchange.js';

async function wireFixture(settings = {}) {
  const db = await testDatabase();
  const broker = await Aedes.createBroker();
  const server = createServer(broker.handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `mqtt://127.0.0.1:${server.address().port}`;
  const simulator = await mqtt.connectAsync(url, { reconnectPeriod: 0 });
  const messages = [];
  simulator.on('message', (topic, payload) => messages.push(JSON.parse(payload.toString())));
  await simulator.subscribeAsync(['fse-01/08/response', 'fse-01/08/status'], { qos: 1 });
  const worker = createMqttWorker(db.pool, { enabled: true, url, candidateId: '08', ...settings });
  return {
    db, broker, server, simulator, messages, worker,
    async close() {
      // Close a potentially unresponsive broker first so failed operations settle.
      await new Promise((resolve) => broker.close(resolve));
      await waitFor(async () => !(await worker.getStatus()).connected);
      await worker.stop();
      await simulator.endAsync(true);
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}

test('invalid broker protocols are rejected before starting any listeners', () => {
  assert.throws(() => createMqttWorker({}, { enabled: true, url: 'https://127.0.0.1:1', candidateId: '08' }), /broker|protocol/i);
});

test('malformed MQTT messages cannot display a stale challenge identity', async () => {
  const fixture = await wireFixture();
  try {
    fixture.worker.start();
    await waitFor(() => fixture.messages.some((message) => message.status === 'ONLINE'));
    await fixture.simulator.publishAsync('fse-01/08/challenge', JSON.stringify(challenge()), { qos: 1 });
    await waitFor(() => fixture.messages.some((message) => message.status === 'COMPLETED'));
    await fixture.simulator.publishAsync('fse-01/08/challenge', '{broken', { qos: 1 });
    await waitFor(() => fixture.messages.some((message) => message.error_code === 'VALIDATION_ERROR'));
    const status = await fixture.worker.getStatus();
    assert.equal(status.last_challenge_id, null);
    assert.equal(status.last_response_body.challenge_id, null);
    assert.equal(status.last_response_status, 'FAILED');
  } finally { await fixture.close(); }
});

test('shutdown completes when the broker withholds OFFLINE PUBACK', async () => {
  const fixture = await wireFixture({ publishTimeoutMs: 200 });
  let stopped;
  try {
    fixture.worker.start();
    await waitFor(() => fixture.messages.some((message) => message.status === 'ONLINE'));
    fixture.broker.authorizePublish = (client, packet, done) => {
      if (packet.topic.endsWith('/status') && JSON.parse(packet.payload.toString()).status === 'OFFLINE') return;
      done(null);
    };
    stopped = fixture.worker.stop();
    const completed = await Promise.race([stopped.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 700))]);
    assert.equal(completed, true, 'shutdown must not hang forever waiting for transport acknowledgement');
  } finally {
    await fixture.close();
    if (stopped) await stopped;
  }
});

test('outbox recovery and MQTT history stay in the configured candidate namespace', async () => {
  const fixture = await wireFixture();
  try {
    await handleChallenge(fixture.db.pool, challenge([count('OWN')], { challenge_id: 'OWN-CH' }), '08');
    await handleChallenge(fixture.db.pool, challenge([count('OTHER')], { challenge_id: 'OTHER-CH', candidate_id: '09' }), '09');
    fixture.worker.start();
    await waitFor(() => fixture.messages.some((message) => message.challenge_id === 'OWN-CH'));
    const status = await fixture.worker.getStatus();
    assert.equal(status.counts.received, 1);
    assert.deepEqual(status.challenges.map((item) => item.challenge_id), ['OWN-CH']);
    assert.ok(fixture.messages.filter((message) => message.challenge_id).every((message) => message.candidate_id === '08'));
  } finally { await fixture.close(); }
});

test('the simulator times out safely when challenge PUBACK is withheld', async () => {
  const fixture = await wireFixture();
  try {
    fixture.broker.authorizePublish = (client, packet, done) => {
      if (packet.topic.endsWith('/challenge')) return;
      done(null);
    };
    await assert.rejects(exchangeChallenge(fixture.simulator, {
      challenge: 'fse-01/08/challenge', response: 'fse-01/08/response',
    }, challenge(), 200), /No matching response/);
  } finally { await fixture.close(); }
});

test('real MQTT transport subscribes, correlates responses, replays safely and sends heartbeats', { timeout: 45000 }, async () => {
  const db = await testDatabase();
  const broker = await Aedes.createBroker();
  const server = createServer(broker.handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `mqtt://127.0.0.1:${server.address().port}`;
  let simulator;
  const worker = createMqttWorker(db.pool, { enabled: true, url, candidateId: '08' });
  try {
    simulator = await mqtt.connectAsync(url, { reconnectPeriod: 0 });
    const messages = [];
    simulator.on('message', (topic, payload, packet) => messages.push({ topic, body: JSON.parse(payload.toString()), qos: packet.qos, retain: packet.retain }));
    await simulator.subscribeAsync(['fse-01/08/response', 'fse-01/08/status'], { qos: 1 });
    worker.start();
    await waitFor(() => messages.find((message) => message.body.status === 'ONLINE'));
    const body = challenge([count('WIRE-COUNT')]);
    await simulator.publishAsync('fse-01/08/challenge', JSON.stringify(body), { qos: 1, retain: false });
    const result = await waitFor(() => messages.find((message) => message.body.challenge_id === body.challenge_id));
    assert.equal(result.body.status, 'COMPLETED');
    assert.equal(result.body.candidate_id, '08');
    assert.equal(result.body.state.net_total, 5);
    assert.equal(result.qos, 1);
    assert.equal(result.retain, false);
    messages.length = 0;
    await simulator.publishAsync('fse-01/08/challenge', JSON.stringify(body), { qos: 1, retain: false });
    const repeated = await waitFor(() => messages.find((message) => message.body.challenge_id === body.challenge_id));
    assert.deepEqual(repeated.body, result.body);
    assert.equal((await db.pool.query('SELECT count(*) FROM submission_attempts')).rows[0].count, '1');
    await waitFor(() => messages.find((message) => message.body.status === 'HEARTBEAT'), 33000);
    assert.equal((await worker.getStatus()).connected, true);
    await worker.stop();
    await waitFor(() => messages.find((message) => message.body.status === 'OFFLINE'));
  } finally {
    await worker.stop();
    if (simulator) await simulator.endAsync(true);
    await new Promise((resolve) => broker.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});

test('MQTT worker reconnects and resubscribes after the broker restarts', { timeout: 20000 }, async () => {
  const db = await testDatabase();
  let broker = await Aedes.createBroker();
  let server = createServer(broker.handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const url = `mqtt://127.0.0.1:${port}`;
  const worker = createMqttWorker(db.pool, { enabled: true, url, candidateId: '08' });
  let simulator;
  try {
    worker.start();
    await waitFor(async () => (await worker.getStatus()).connected);
    await new Promise((resolve) => broker.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await waitFor(async () => !(await worker.getStatus()).connected);
    broker = await Aedes.createBroker();
    server = createServer(broker.handle);
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    await waitFor(async () => (await worker.getStatus()).connected);
    simulator = await mqtt.connectAsync(url, { reconnectPeriod: 0 });
    let response;
    simulator.on('message', (topic, payload) => { response = JSON.parse(payload.toString()); });
    await simulator.subscribeAsync('fse-01/08/response', { qos: 1 });
    await simulator.publishAsync('fse-01/08/challenge', JSON.stringify(challenge()), { qos: 1, retain: false });
    await waitFor(() => response);
    assert.equal(response.status, 'COMPLETED');
  } finally {
    await worker.stop();
    if (simulator) await simulator.endAsync(true);
    await new Promise((resolve) => broker.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});
