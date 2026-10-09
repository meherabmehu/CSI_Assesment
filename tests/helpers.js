import { randomBytes } from 'node:crypto';
import { createPool } from '../src/shared/db.js';
import { migrate } from '../scripts/migrate.js';

export async function testDatabase() {
  const database = `cis_assessment_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = createPool({ database: 'postgres' });
  await admin.query(`CREATE DATABASE ${database}`);
  const pool = createPool({ database });
  await migrate(pool);
  return {
    database, pool,
    async reset() {
      const actual = (await pool.query('SELECT current_database() AS name')).rows[0].name;
      if (actual !== database || !/^cis_assessment_test_\d+_[a-f0-9]+$/.test(actual)) throw new Error('Refusing to reset a non-test database.');
      await pool.query('TRUNCATE audit_log, mqtt_challenges, submission_attempts, production_events, production_sources RESTART IDENTITY CASCADE');
    },
    async close() {
      await pool.end();
      if (!/^cis_assessment_test_\d+_[a-f0-9]+$/.test(database)) throw new Error('Refusing to drop a non-test database.');
      await admin.query(`DROP DATABASE ${database}`);
      await admin.end();
    },
  };
}

export function count(id = 'EV-101', quantity = 5, source = 'LINE-01') {
  return { source_id: source, event_id: id, type: 'COUNT', quantity, event_time: '2026-10-09T10:30:00Z' };
}

export function voidEvent(id = 'EV-VOID', target = 'EV-101', source = 'LINE-01') {
  return { source_id: source, event_id: id, type: 'VOID', target_event_id: target, event_time: '2026-10-09T10:31:00Z' };
}

export function challenge(events = [count()], overrides = {}) {
  return {
    protocol_version: '1.0', candidate_id: '08', challenge_id: 'CH-TEST', command: 'PROCESS_EVENTS',
    sent_at: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + 15000).toISOString(),
    events, ...overrides,
  };
}

export async function waitFor(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the expected result.');
}
