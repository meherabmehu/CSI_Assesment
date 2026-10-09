import mqtt from 'mqtt';
import { randomUUID } from 'node:crypto';
import { handleChallenge } from './service.js';
import { failureResponse } from './protocol.js';
import { validIdentifier } from '../../shared/json.js';
import { withDeadline } from '../../shared/deadline.js';
import { withTransaction } from '../../shared/db.js';

export function createMqttWorker(pool, settings) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(settings.candidateId)) throw new Error('CANDIDATE_ID must be a single safe topic segment.');
  let brokerUrl;
  try { brokerUrl = new URL(settings.url); }
  catch { throw new Error('Invalid MQTT broker URL.'); }
  if (!['mqtt:', 'mqtts:', 'ws:', 'wss:'].includes(brokerUrl.protocol) || !brokerUrl.hostname) {
    throw new Error('MQTT broker protocol must be mqtt, mqtts, ws or wss.');
  }
  const prefix = `fse-01/${settings.candidateId}`;
  const topics = { challenge: `${prefix}/challenge`, response: `${prefix}/response`, status: `${prefix}/status` };
  let client;
  const publishTimeout = settings.publishTimeoutMs || 5000;
  let timer;
  let reconnectTimer;
  let reconnectDelay = 1000;
  let connectionEpoch = 0;
  let stopPromise;
  let recovering = false;
  let stopping = false;
  let queue = Promise.resolve();
  const monitor = {
    enabled: settings.enabled, connected: false, state: settings.enabled ? 'CONNECTING' : 'DISABLED',
    candidate_id: settings.candidateId,
    broker: `${brokerUrl.protocol}//${brokerUrl.host}${brokerUrl.pathname === '/' ? '' : brokerUrl.pathname}`,
    topics, last_response_body: null,
    last_error: null, last_challenge_id: null, last_challenge_time: null, last_response_status: null,
    connected_at: null, last_heartbeat_at: null,
  };

  function statusMessage(status) {
    return JSON.stringify({ protocol_version: '1.0', candidate_id: settings.candidateId, status, timestamp: new Date().toISOString() });
  }

  function scheduleReconnect() {
    if (stopping || reconnectTimer) return;
    monitor.state = 'RECONNECTING';
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      if (!stopping) client.reconnect();
    }, reconnectDelay);
  }

  async function retryConnection() {
    if (stopping) return;
    monitor.connected = false;
    // Flush pending QoS callbacks; PostgreSQL's outbox owns retry recovery.
    await client.endAsync(true).catch(() => {});
    scheduleReconnect();
  }

  function publish(topic, payload) {
    if (!client?.connected) return Promise.reject(new Error('MQTT is disconnected.'));
    return withDeadline(client.publishAsync(topic, payload, { qos: 1, retain: false }), publishTimeout, 'MQTT PUBACK timed out.');
  }

  async function publishResponse(response) {
    if (stopping) return false;
    try {
      await publish(topics.response, JSON.stringify(response));
      if (response.challenge_id) {
        // Never replace the original replay response when publishing a conflict failure.
        await pool.query(`UPDATE mqtt_challenges SET delivery_attempts = delivery_attempts + 1,
          last_published_at = clock_timestamp() WHERE challenge_id = $1 AND response_body = $2::jsonb`,
        [response.challenge_id, JSON.stringify(response)]);
      }
      return true;
    } catch {
      monitor.last_error = 'Response delivery failed; the stored response will be retried.';
      await retryConnection();
      return false;
    }
  }

  async function recoverResponses() {
    if (recovering || stopping || !monitor.connected) return;
    recovering = true;
    try {
      while (!stopping && monitor.connected) {
        const unsent = await pool.query(`SELECT response_body FROM mqtt_challenges
          WHERE last_published_at IS NULL AND response_body->>'candidate_id' = $1
          ORDER BY received_at LIMIT 100`, [settings.candidateId]);
        if (!unsent.rowCount) break;
        for (const row of unsent.rows) if (!await publishResponse(row.response_body)) return;
      }
    } catch { monitor.last_error = 'Stored responses could not be recovered; recovery will be retried.'; }
    finally { recovering = false; }
  }

  async function receive(payload) {
    if (stopping) return;
    let body;
    let response;
    monitor.last_challenge_id = null;
    monitor.last_challenge_time = new Date().toISOString();
    try {
      if (payload.length > 1024 * 1024) throw new Error('too-large');
      body = JSON.parse(payload.toString());
    } catch {
      response = failureResponse(null, settings.candidateId, 'VALIDATION_ERROR', 'The challenge must contain valid JSON smaller than 1 MB.');
    }
    if (body !== undefined) {
      monitor.last_challenge_id = validIdentifier(body?.challenge_id) ? body.challenge_id : null;
      try { response = await handleChallenge(pool, body, settings.candidateId); }
      catch { response = failureResponse(body, settings.candidateId, 'INTERNAL_ERROR', 'The challenge could not be processed.'); }
    }
    monitor.last_response_status = response.status;
    monitor.last_response_body = response;
    monitor.last_error = response.status === 'FAILED' ? `${response.error_code}: ${response.message}` : null;
    await publishResponse(response);
  }

  function start() {
    if (!settings.enabled || client || stopping) return;
    client = mqtt.connect(settings.url, {
      clientId: `fse01-${settings.candidateId}-${randomUUID().slice(0, 8)}`,
      protocolVersion: 4, clean: true, keepalive: 30, connectTimeout: 8000,
      reconnectPeriod: 0, resubscribe: false,
      will: { topic: topics.status, payload: statusMessage('OFFLINE'), qos: 1, retain: false },
    });
    client.on('connect', async () => {
      if (stopping) return;
      const epoch = connectionEpoch;
      try {
        const grants = await withDeadline(client.subscribeAsync(topics.challenge, { qos: 1 }), publishTimeout, 'MQTT subscription timed out.');
        if (stopping || epoch !== connectionEpoch) return;
        if (!grants.length || grants.some((grant) => grant.qos === 128)) throw new Error('subscription-rejected');
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
        reconnectDelay = 1000;
        monitor.connected = true;
        monitor.state = 'ONLINE';
        monitor.connected_at = new Date().toISOString();
        monitor.last_error = null;
        await publish(topics.status, statusMessage('ONLINE'));
        await recoverResponses();
      } catch {
        if (stopping || epoch !== connectionEpoch) return;
        monitor.last_error = 'MQTT subscription or status delivery failed; reconnecting.';
        await retryConnection();
      }
    });
    client.on('message', (topic, payload) => {
      if (topic === topics.challenge && !stopping) queue = queue.then(() => receive(payload)).catch(() => {
        monitor.last_error = 'A challenge could not be handled.';
      });
    });
    client.on('close', () => {
      connectionEpoch++;
      monitor.connected = false;
      monitor.state = stopping ? 'OFFLINE' : 'RECONNECTING';
      scheduleReconnect();
    });
    client.on('error', () => { monitor.last_error = 'MQTT connection failed. Check the broker address and network.'; });
    timer = setInterval(async () => {
      if (!monitor.connected || stopping) return;
      try {
        await publish(topics.status, statusMessage('HEARTBEAT'));
        monitor.last_heartbeat_at = new Date().toISOString();
        await recoverResponses();
      } catch {
        monitor.last_error = 'MQTT heartbeat delivery failed; reconnecting.';
        await retryConnection();
      }
    }, 30000);
    timer.unref();
  }

  async function getStatus() {
    return withTransaction(pool, async (db) => {
    const counts = await db.query(`SELECT count(*) AS received,
      count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
      count(*) FILTER (WHERE status = 'FAILED') AS failed FROM mqtt_challenges
      WHERE response_body->>'candidate_id' = $1`, [settings.candidateId]);
    const recent = await db.query(`SELECT challenge_id, status, processed_at, received_at, last_published_at,
      delivery_attempts, response_body->>'error_code' AS error_code, response_body
      FROM mqtt_challenges WHERE response_body->>'candidate_id' = $1
      ORDER BY received_at DESC LIMIT 20`, [settings.candidateId]);
    const latest = recent.rows[0];
    const receivedInThisProcess = monitor.last_challenge_time !== null;
    return {
      ...monitor,
      last_challenge_id: receivedInThisProcess ? monitor.last_challenge_id : latest?.challenge_id || null,
      last_challenge_time: receivedInThisProcess ? monitor.last_challenge_time : latest?.received_at || null,
      last_response_status: receivedInThisProcess ? monitor.last_response_status : latest?.status || null,
      last_response_body: receivedInThisProcess ? monitor.last_response_body : latest?.response_body || null,
      counts: Object.fromEntries(Object.entries(counts.rows[0]).map(([key, value]) => [key, Number(value)])),
      challenges: recent.rows,
    };
    }, { readOnly: true });
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopping = true;
      clearInterval(timer);
      clearTimeout(reconnectTimer);
      if (client) {
        if (client.connected) await publish(topics.status, statusMessage('OFFLINE')).catch(() => {});
        await client.endAsync(true);
        await withDeadline(queue, publishTimeout, 'Challenge shutdown timed out.').catch(() => {});
      }
      monitor.connected = false;
      monitor.state = 'OFFLINE';
    })();
    return stopPromise;
  }

  return { start, stop, getStatus };
}
