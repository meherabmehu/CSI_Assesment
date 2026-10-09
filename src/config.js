import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  database: {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'cis_assessment',
    max: 10,
    connectionTimeoutMillis: 5000,
  },
  mqtt: {
    enabled: process.env.MQTT_ENABLED !== 'false',
    url: process.env.MQTT_BROKER_URL || 'mqtt://152.42.238.142:1883',
    candidateId: process.env.CANDIDATE_ID || '08',
  },
};
