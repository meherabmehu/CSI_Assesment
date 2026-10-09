const response = await fetch('http://127.0.0.1:3000/api/dashboard', { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error('Start the local application before running the demo.');
const dashboard = await response.json();
const broker = new URL(dashboard.mqtt.broker);
if (broker.protocol !== 'mqtt:' || broker.hostname !== '127.0.0.1' || broker.username || broker.password) {
  throw new Error('The app must be started with START_LOCAL.cmd to use the local MQTT demo.');
}
process.env.MQTT_BROKER_URL = broker.href;
process.env.CANDIDATE_ID = dashboard.mqtt.candidate_id;
process.env.SIMULATION_EVIDENCE_MODE = 'local';
await import('./simulate-mqtt.js');
