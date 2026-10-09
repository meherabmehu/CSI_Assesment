import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { testDatabase } from './helpers.js';

async function runStartup(database, overrides) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PGDATABASE: database, HOST: '127.0.0.1', PORT: '0', MQTT_ENABLED: 'false', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const timeout = setTimeout(() => child.kill(), 4000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null, 'startup must exit itself instead of leaking an HTTP listener');
    assert.equal(code, 1);
    assert.match(output, /Startup failed/);
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); }
}

test('invalid MQTT configuration fails startup without leaking an HTTP listener', async () => {
  const db = await testDatabase();
  try { await runStartup(db.database, { MQTT_ENABLED: 'true', MQTT_BROKER_URL: 'https://127.0.0.1:1' }); }
  finally { await db.close(); }
});

test('an occupied HTTP port fails startup without starting an MQTT connection', async () => {
  const db = await testDatabase();
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  try { await runStartup(db.database, { PORT: String(listener.address().port), MQTT_BROKER_URL: 'mqtt://127.0.0.1:1' }); }
  finally { await new Promise((resolve) => listener.close(resolve)); await db.close(); }
});
