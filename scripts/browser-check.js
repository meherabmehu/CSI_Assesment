import { mkdir, writeFile, access } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import { testDatabase, count, voidEvent, challenge, waitFor } from '../tests/helpers.js';
import { processEvents } from '../src/modules/events/service.js';
import { acknowledgeEvents } from '../src/modules/ack/service.js';
import { createMqttWorker } from '../src/modules/mqtt/worker.js';
import { createApp } from '../src/app.js';

const artifactDir = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(artifactDir, { recursive: true });
const db = await testDatabase();
const broker = await Aedes.createBroker();
const brokerServer = createServer(broker.handle);
brokerServer.listen(0, '127.0.0.1');
await once(brokerServer, 'listening');
const url = `mqtt://127.0.0.1:${brokerServer.address().port}`;
const worker = createMqttWorker(db.pool, { enabled: true, url, candidateId: '08' });
const server = createApp(db.pool, worker).listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let simulator;
const checks = [];
const errors = [];
const pass = (message) => { checks.push(message); console.log('PASS:', message); };

try {
  await processEvents(db.pool, [count('EV-101', 120), count('EV-102', 85, 'LINE-02'), count('EV-103', 60, 'LINE-03'),
    voidEvent('EV-CORRECTION', 'EV-103', 'LINE-03'), voidEvent('EV-WAITING', 'EV-NOT-YET'), count('EV-101', 120),
    count('EV-102', 99, 'LINE-02'), count('EV-INVALID', -1)]);
  await acknowledgeEvents(db.pool, ['EV-102']);
  simulator = await mqtt.connectAsync(url, { reconnectPeriod: 0 });
  let wireResponse;
  simulator.on('message', (topic, payload) => { wireResponse = JSON.parse(payload.toString()); });
  await simulator.subscribeAsync('fse-01/08/response', { qos: 1 });
  worker.start();
  await waitFor(async () => (await worker.getStatus()).connected);
  await simulator.publishAsync('fse-01/08/challenge', JSON.stringify(challenge([count('EV-MQTT', 35, 'LINE-03')], { challenge_id: 'CH-MQTT-001' })), { qos: 1, retain: false });
  await waitFor(() => wireResponse);
  assert.equal(wireResponse.state.net_total, 240);
  pass('MQTT challenge travels through a real local broker into PostgreSQL');

  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  let executablePath = process.env.BROWSER_PATH;
  if (!executablePath) {
    try { await access(edge); executablePath = edge; } catch { /* Use Playwright Chromium if installed. */ }
  }
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Dhaka' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('metric-net_total').textContent === '240');
  assert.equal(await page.locator('#candidate-id').textContent(), '08');
  assert.equal(await page.locator('#mqtt-state').textContent(), 'Connected');
  assert.equal(await page.locator('#last-challenge-id').textContent(), 'CH-MQTT-001');
  pass('Desktop dashboard displays real totals, employee ID 08 and correlated MQTT status');
  await page.screenshot({ path: artifactDir + 'dashboard-desktop.png', fullPage: true });
  await page.locator('#response-details summary').click();
  await page.locator('.detail-column').screenshot({ path: artifactDir + 'mqtt-response.png' });
  await page.locator('#response-details summary').click();

  await page.getByRole('button', { name: 'Count +5', exact: true }).click();
  await page.locator('#submit-button').click();
  await page.waitForFunction(() => document.getElementById('metric-net_total').textContent === '245');
  pass('Submitting a COUNT updates the dashboard from the backend');
  await page.locator('#submit-button').click();
  await page.waitForFunction(() => document.querySelector('#submission-results .badge')?.textContent === 'DUPLICATE');
  assert.equal(await page.locator('#metric-net_total').textContent(), '245');
  pass('Submitting the same event twice shows DUPLICATE without extra production');
  await page.getByRole('button', { name: 'Correction', exact: true }).click();
  await page.locator('#submit-button').click();
  await page.waitForFunction(() => document.getElementById('metric-net_total').textContent === '240');
  pass('The correction example reverses the submitted count');

  const beforeAck = Number(await page.locator('#metric-pending_ack').textContent());
  await page.locator('[data-event-checkbox]').first().check();
  await page.locator('#ack-button').click();
  await page.waitForFunction((previous) => Number(document.getElementById('metric-pending_ack').textContent) === previous - 1, beforeAck);
  pass('Selecting and acknowledging an event reduces pending review');

  await page.locator('#tab-exceptions').click();
  assert.ok((await page.locator('#table-body').textContent()).includes('PENDING REFERENCE'));
  assert.ok((await page.locator('#table-body').textContent()).includes('CONFLICT'));
  await page.screenshot({ path: artifactDir + 'dashboard-exceptions.png', fullPage: true });
  pass('Exceptions show pending references, rejected submissions and conflicts');

  await page.locator('#event-input').fill('{broken');
  await page.locator('#submit-button').click();
  assert.ok((await page.locator('#submit-message').textContent()).includes('valid JSON'));
  pass('Invalid JSON shows a helpful inline error');
  await page.locator('#source-filter').selectOption('LINE-02');
  await page.waitForFunction(() => document.getElementById('metric-net_total').textContent === '85');
  pass('The source filter loads that line’s actual production and exceptions');

  await page.locator('#source-filter').selectOption('');
  await page.waitForFunction(() => document.getElementById('metric-net_total').textContent === '240');
  await page.locator('#tab-pending').click();
  await page.locator('#event-search').fill('DOES-NOT-EXIST');
  assert.ok((await page.locator('#table-empty').textContent()).includes('No matching events'));
  await page.locator('#event-search').fill('');
  pass('Searching events handles an empty result');

  await page.getByRole('button', { name: 'Count +5', exact: true }).click();
  await page.locator('#event-input').blur();
  await page.waitForFunction(() => document.getElementById('toast').hidden);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  assert.ok(widths.page <= widths.viewport, `Mobile overflow: ${widths.page} > ${widths.viewport}`);
  await page.screenshot({ path: artifactDir + 'dashboard-mobile.png', fullPage: true });
  pass('390px mobile layout has no page overflow');

  await page.route('**/api/dashboard*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test backend outage' }) }));
  await page.locator('#refresh').click();
  await page.waitForFunction(() => !document.getElementById('connection-error').hidden);
  assert.ok((await page.locator('#sync-label').textContent()).includes('last successful'));
  pass('Backend failure is visible and retained values are labelled as stale');
  assert.deepEqual(errors, []);
  pass('No browser JavaScript errors');

  const apiPage = await context.newPage();
  await apiPage.goto(base + '/api/state');
  await apiPage.screenshot({ path: artifactDir + 'rest-api-response.png' });
  await apiPage.close();

  const apiEvidence = {
    note: 'Evidence from an isolated temporary PostgreSQL database and a real local MQTT broker. No production data was seeded.',
    checked_at: new Date().toISOString(),
    health: await (await fetch(base + '/api/health')).json(),
    summary: await (await fetch(base + '/api/state')).json(),
    mqtt_response: wireResponse,
    checks,
  };
  await writeFile(artifactDir + 'browser-verification.json', JSON.stringify(apiEvidence, null, 2) + '\n');
} finally {
  if (browser) await browser.close();
  await worker.stop();
  if (simulator) await simulator.endAsync(true);
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => broker.close(resolve));
  await new Promise((resolve) => brokerServer.close(resolve));
  await db.close();
}
