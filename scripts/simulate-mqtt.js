import mqtt from 'mqtt';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { config } from '../src/config.js';
import { exchangeChallenge } from '../src/modules/mqtt/exchange.js';

const candidateId = config.mqtt.candidateId;
if (!/^[A-Za-z0-9_-]{1,64}$/.test(candidateId)) throw new Error('Invalid candidate topic ID.');
const challengeId = `CH-DEMO-${randomUUID().slice(0, 8)}`;
const countId = `EV-DEMO-${randomUUID().slice(0, 8)}`;
let client;
try {
  const suppliedBody = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : null;
  client = await mqtt.connectAsync(config.mqtt.url, { clientId: `fse01-${candidateId}-demo-${randomUUID().slice(0, 6)}`,
    protocolVersion: 4, connectTimeout: 8000, reconnectPeriod: 0 });
  await client.subscribeAsync(`fse-01/${candidateId}/response`, { qos: 1 });
  const timestamp = new Date().toISOString();
  const event = { source_id: 'DEMO-LINE', event_id: countId, type: 'COUNT', quantity: 5, event_time: timestamp };
  const body = suppliedBody ?? {
    protocol_version: '1.0', candidate_id: candidateId, challenge_id: challengeId, command: 'PROCESS_EVENTS',
    sent_at: timestamp, expires_at: new Date(Date.now() + 15000).toISOString(),
    events: [event, { ...event }, { source_id: 'DEMO-LINE', event_id: `${countId}-VOID`, type: 'VOID', target_event_id: countId, event_time: timestamp }],
  };
  const result = await exchangeChallenge(client, {
    challenge: `fse-01/${candidateId}/challenge`, response: `fse-01/${candidateId}/response`,
  }, body);
  console.log(JSON.stringify(result, null, 2));
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  const evidenceFile = process.env.SIMULATION_EVIDENCE_MODE === 'local' ? 'mqtt-local-verification.json' : 'mqtt-live-verification.json';
  await writeFile(new URL(`../artifacts/${evidenceFile}`, import.meta.url), JSON.stringify({ broker: config.mqtt.url, request: body, response: result }, null, 2) + '\n');
  if (result.status !== 'COMPLETED') process.exitCode = 1;
} catch (error) {
  console.error('MQTT simulation failed:', error.message);
  process.exitCode = 1;
} finally { if (client) await client.endAsync(true); }
