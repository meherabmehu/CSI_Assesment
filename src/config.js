import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { parse } from 'pg-connection-string';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

export function buildConfig(env) {
  let database;
  try {
    if (env.DATABASE_URL) {
      const url = new URL(env.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error();
      if (env.PGSSLMODE && !url.searchParams.has('sslmode')) url.searchParams.set('sslmode', env.PGSSLMODE);
      const mode = url.searchParams.get('sslmode');
      if (mode && !['disable', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify'].includes(mode)) throw new Error();
      // Match PostgreSQL sslmode=require semantics, including Render's self-signed internal TLS.
      database = parse(url.href, { useLibpqCompat: mode !== 'no-verify' && !url.searchParams.has('uselibpqcompat') });
    } else {
      if (env.RENDER === 'true' && !env.PGHOST) throw new Error();
      database = {
        host: env.PGHOST || 'localhost', port: Number(env.PGPORT || 5432),
        user: env.PGUSER || 'postgres', password: env.PGPASSWORD || '',
        database: env.PGDATABASE || 'cis_assessment',
      };
      if (env.PGSSLMODE) {
        const mode = env.PGSSLMODE;
        if (!['disable', 'require', 'verify-full', 'no-verify'].includes(mode)) throw new Error();
        database.ssl = mode === 'disable' ? false : { rejectUnauthorized: mode === 'verify-full' };
      }
    }
  } catch {
    const error = new Error('Invalid PostgreSQL configuration. Set DATABASE_URL or PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE; check SSL settings.');
    error.code = 'CONFIG_ERROR';
    throw error;
  }
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || (env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1'),
    database: {
      ...database,
      max: 10,
      connectionTimeoutMillis: 5000,
    },
    mqtt: {
      enabled: env.MQTT_ENABLED !== 'false',
      url: env.MQTT_BROKER_URL || 'mqtt://152.42.238.142:1883',
      candidateId: env.CANDIDATE_ID || '08',
    },
  };
}

export const config = buildConfig(process.env);
