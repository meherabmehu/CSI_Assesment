import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildConfig } from '../src/config.js';
import { safeError } from '../src/shared/errors.js';

test('Render DATABASE_URL overrides local PG settings and decodes credentials', () => {
  const settings = buildConfig({ RENDER: 'true', PORT: '10000', DATABASE_URL: 'postgresql://cloud:p%40ss%3Aword@db.example/cloud_db', PGHOST: 'localhost', PGUSER: 'postgres', PGDATABASE: 'wrong' });
  assert.equal(settings.host, '0.0.0.0');
  assert.equal(settings.port, 10000);
  const connection = new pg.Client(settings.database).connectionParameters;
  assert.equal(connection.host, 'db.example');
  assert.equal(connection.user, 'cloud');
  assert.equal(connection.password, 'p@ss:word');
  assert.equal(connection.database, 'cloud_db');
});

test('SSL modes work for URL and individual PG settings without losing URL precedence', () => {
  for (const mode of ['disable', 'require', 'verify-full']) {
    for (const url of [undefined, `postgres://user:password@db.example/name?sslmode=${mode}`]) {
      const settings = buildConfig({ DATABASE_URL: url, PGSSLMODE: mode, PGHOST: 'db.example' });
      const ssl = new pg.Client(settings.database).connectionParameters.ssl;
      if (mode === 'disable') assert.equal(ssl, false);
      else assert.equal(ssl.rejectUnauthorized !== false, mode === 'verify-full');
    }
  }
  assert.equal(buildConfig({ DATABASE_URL: 'postgres://u:p@db.example/name?sslmode=disable', PGSSLMODE: 'require' }).database.ssl, false);
  assert.equal(buildConfig({ DATABASE_URL: 'postgres://u:p@db.example/name', PGSSLMODE: 'require' }).database.ssl.rejectUnauthorized, false);
});

test('Render cannot silently fall back to local database settings and malformed URLs are safe', () => {
  assert.throws(() => buildConfig({ RENDER: 'true' }), /Invalid PostgreSQL configuration/);
  assert.throws(() => buildConfig({ DATABASE_URL: 'secret-invalid-value' }), error => error.code === 'CONFIG_ERROR' && !error.message.includes('secret-invalid-value'));
  assert.equal(buildConfig({}).host, '127.0.0.1');
  assert.equal(buildConfig({ RENDER: 'true', PGHOST: 'private-db', HOST: '0.0.0.0' }).host, '0.0.0.0');
});

test('error diagnostics never expose messages, URLs, credentials or SQL details', () => {
  const secret = 'postgresql://private-user:private-password@private-host/private-db';
  for (const code of ['28P01', '42501', 'ECONNREFUSED', '42P01', 'unknown-code']) {
    const output = JSON.stringify(safeError({ code, message: secret, detail: secret, stack: secret }));
    assert.ok(!output.includes('private-'));
  }
  assert.equal(safeError({ message: `The server does not support SSL ${secret}` }).code, 'SSL_UNSUPPORTED');
});
