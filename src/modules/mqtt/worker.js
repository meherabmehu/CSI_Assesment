import mqtt from 'mqtt';
import { randomUUID } from 'node:crypto';
import { handleChallenge } from './service.js';
import { failureResponse } from './protocol.js';

export function createMqttWorker(pool, settings) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(settings.candidateId)) throw new Error('CANDIDATE_ID must be a single safe topic segment.');
  const prefix = `fse-01/${settings.candidateId}`;
  const topics = { challenge: `${prefix}/challenge`, response: `${prefix}/response`, status: `${prefix}/status` };
  let client;
  let timer;
  let stopping = false;
  let queue = Promise.resolve();
  const monitor = {
    enabled: settings.enabled, connected: false, state: settings.enabled ? 'CONNECTING' : 'DISABLED',
    candidate_id: settings.candidateId, broker: settings.url, topics,
    last_error: null, last_challenge_id: null, last_challenge_time: null, last_response_status: null,
    connected_at: null, last_heartbeat_at: null,
  };

  function statusMessage(status) {
    return JSON.stringify({ protocol_version: '1.0', candidate_id: settings.candidateId, status, timestamp: new Date().toISOString() });
  }

  async function publishResponse(response) {
    try {
      await client.publishAsync(topics.response, JSON.stringify(response), { qos: 1, retain: false });
      if (response.challenge_id) {
        // Never replace the original replay response when publishing a conflict failure.
        await pool.query(`UPDATE mqtt_challenges SET delivery_attempts = delivery_attempts + 1,
          last_published_at = clock_timestamp() WHERE challenge_id = $1 AND response_body = $2::jsonb`,
        [response.challenge_id, JSON.stringify(response)]);
      }
    } catch {
      monitor.last_error = 'Response delivery failed; a stored response will be retried after reconnect.';
    }
  }

  async function receive(payload) {
    let body;
    let response;
    try {
      if (payload.length > 1024 * 1024) throw new Error('too-large');
      body = JSON.parse(payload.toString());
    } catch {
      response = failureResponse(null, settings.candidateId, 'VALIDATION_ERROR', 'The challenge must contain valid JSON smaller than 1 MB.');
    }
    if (body !== undefined) {
      monitor.last_challenge_id = typeof body?.challenge_id === 'string' ? body.challenge_id : null;
      monitor.last_challenge_time = new Date().toISOString();
      try { response = await handleChallenge(pool, body, settings.candidateId); }
      catch { response = failureResponse(body, settings.candidateId, 'INTERNAL_ERROR', 'The challenge could not be processed.'); }
    }
    monitor.last_response_status = response.status;
    monitor.last_error = response.status === 'FAILED' ? `${response.error_code}: ${response.message}` : null;
    await publishResponse(response);
  }

  function start() {
    if (!settings.enabled || client) return;
    client = mqtt.connect(settings.url, {
      clientId: `fse01-${settings.candidateId}-${randomUUID().slice(0, 8)}`,
      protocolVersion: 4, clean: true, keepalive: 30, connectTimeout: 8000,
      reconnectPeriod: 1000, resubscribe: false,
      will: { topic: topics.status, payload: statusMessage('OFFLINE'), qos: 1, retain: false },
    });
    client.on('connect', async () => {
      if (stopping) return;
      try {
        const grants = await client.subscribeAsync(topics.challenge, { qos: 1 });
        if (grants.some((grant) => grant.qos === 128)) throw new Error('subscription-rejected');
        monitor.connected = true;
        monitor.state = 'ONLINE';
        monitor.connected_at = new Date().toISOString();
        monitor.last_error = null;
        client.options.reconnectPeriod = 1000;
        await client.publishAsync(topics.status, statusMessage('ONLINE'), { qos: 1, retain: false });
        const unsent = await pool.query('SELECT response_body FROM mqtt_challenges WHERE last_published_at IS NULL ORDER BY received_at');
        for (const row of unsent.rows) await publishResponse(row.response_body);
      } catch {
        monitor.connected = false;
        monitor.state = 'ERROR';
        monitor.last_error = 'MQTT subscription or recovery failed; reconnecting.';
        client.reconnect();
      }
    });
    client.on('message', (topic, payload) => {
      if (topic === topics.challenge) queue = queue.then(() => receive(payload)).catch(() => {
        monitor.last_error = 'A challenge could not be handled.';
      });
    });
    client.on('reconnect', () => {
      monitor.state = 'RECONNECTING';
      client.options.reconnectPeriod = Math.min(client.options.reconnectPeriod * 2, 30000);
    });
    client.on('close', () => { monitor.connected = false; monitor.state = stopping ? 'OFFLINE' : 'RECONNECTING'; });
    client.on('error', () => { monitor.last_error = 'MQTT connection failed. Check the broker address and network.'; });
    timer = setInterval(() => {
      if (!monitor.connected) return;
      client.publish(topics.status, statusMessage('HEARTBEAT'), { qos: 1, retain: false }, (error) => {
        if (error) monitor.last_error = 'MQTT heartbeat could not be sent.';
        else monitor.last_heartbeat_at = new Date().toISOString();
      });
    }, 30000);
    timer.unref();
  }

  async function getStatus() {
    const counts = await pool.query(`SELECT count(*) AS received,
      count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
      count(*) FILTER (WHERE status = 'FAILED') AS failed FROM mqtt_challenges`);
    const recent = await pool.query(`SELECT challenge_id, status, processed_at, received_at, last_published_at,
      delivery_attempts, response_body->>'error_code' AS error_code, response_body
      FROM mqtt_challenges ORDER BY received_at DESC LIMIT 20`);
    const latest = recent.rows[0];
    return {
      ...monitor,
      last_challenge_id: monitor.last_challenge_id || latest?.challenge_id || null,
      last_challenge_time: monitor.last_challenge_time || latest?.received_at || null,
      last_response_status: monitor.last_response_status || latest?.status || null,
      counts: Object.fromEntries(Object.entries(counts.rows[0]).map(([key, value]) => [key, Number(value)])),
      challenges: recent.rows,
    };
  }

  async function stop() {
    stopping = true;
    clearInterval(timer);
    if (client) {
      if (monitor.connected) await client.publishAsync(topics.status, statusMessage('OFFLINE'), { qos: 1, retain: false }).catch(() => {});
      await client.endAsync(true);
      await queue;
    }
    monitor.connected = false;
    monitor.state = 'OFFLINE';
  }

  return { start, stop, getStatus };
}
