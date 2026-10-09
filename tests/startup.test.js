import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { testDatabase } from './helpers.js';
import { config } from '../src/config.js';

async function runStartup(database, overrides, expectedMessage) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, PGDATABASE: database, HOST: '127.0.0.1', PORT: '0', MQTT_ENABLED: 'false', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  let standardOutput = '';
  child.stdout.on('data', (chunk) => { standardOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const timeout = setTimeout(() => child.kill(), 10000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null, 'startup must exit itself instead of leaking an HTTP listener');
    assert.equal(code, 1);
    assert.match(output, /Startup failed/);
    if (expectedMessage) assert.match(output, expectedMessage);
    assert.doesNotMatch(standardOutput, /NorthBridge dashboard:/, 'failed startup must not announce a ready dashboard');
    assert.doesNotMatch(output, /private_startup_database_should_not_exist/);
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
  try { await runStartup(db.database, { PORT: String(listener.address().port), MQTT_BROKER_URL: 'mqtt://127.0.0.1:1' }, /already in use/); }
  finally { await new Promise((resolve) => listener.close(resolve)); await db.close(); }
});

test('a missing database reports the connectivity stage and code without leaking the database name', async () => {
  await runStartup('private_startup_database_should_not_exist', {}, /database connectivity[\s\S]*3D000/);
});

test('Render-style DATABASE_URL connects, migrates repeatedly and serves HTTP with stale PG variables', async () => {
  const db = await testDatabase();
  const { user, password, host, port } = config.database;
  const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db.database}?sslmode=disable`;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const child = spawn(process.execPath, ['src/server.js'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
        env: { ...process.env, RENDER: 'true', DATABASE_URL: databaseUrl, HOST: '', PORT: '0', MQTT_ENABLED: 'false', PGHOST: 'invalid-host', PGPASSWORD: 'invalid-password', PGDATABASE: 'wrong_database' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      let failureOutput = '';
      child.stderr.on('data', chunk => { failureOutput += chunk.toString(); });
      try {
        const portNumber = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Render-style startup timed out')), 7000);
          child.stdout.on('data', chunk => {
            output += chunk.toString();
            const match = output.match(/http:\/\/0\.0\.0\.0:(\d+)/);
            if (match) { clearTimeout(timeout); resolve(match[1]); }
          });
          child.once('exit', () => { clearTimeout(timeout); reject(new Error('Render-style startup failed')); });
        });
        assert.equal((await (await fetch(`http://127.0.0.1:${portNumber}/api/health`)).json()).database, 'connected');
        assert.equal((await (await fetch(`http://127.0.0.1:${portNumber}/api/state`)).json()).rejected_submissions, attempt);
        assert.equal(failureOutput, '');
        if (attempt === 0) await db.pool.query("INSERT INTO submission_attempts (raw_payload, raw_payload_text, classification, transport) VALUES ('{}', '{}', 'REJECTED', 'REST')");
      } finally { const stopped = once(child, 'exit'); child.kill(); await stopped; }
    }
    assert.equal((await db.pool.query("SELECT count(*) FROM information_schema.columns WHERE table_name = 'submission_attempts' AND column_name = 'raw_payload_text'")).rows[0].count, '1');
  } finally { await db.close(); }
});
