import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { api } from '../frontend/api.js';

test('a stalled mutation times out with a safe retry message instead of remaining blocked', async () => {
  let received;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    // Deliberately withhold the response after receiving the event.
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(api(`http://127.0.0.1:${server.address().port}`, {
      method: 'POST', body: JSON.stringify({ event_id: 'KEEP-THIS-ID' }), timeoutMs: 300,
    }), /outcome is unknown; retry with the same event IDs/);
    assert.deepEqual(received, { event_id: 'KEEP-THIS-ID' });
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('an aborted refresh is distinguished from a mutation timeout', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api('http://127.0.0.1:1', { signal: controller.signal }), { name: 'AbortError' });
});
