# Render Startup Configuration

Keep the repository root, build command `npm ci`, and start command `npm start`.

## Web service environment variables

| Name | Value / action |
| --- | --- |
| `DATABASE_URL` | Set to the PostgreSQL service's **Internal Database URL**, copied directly within the Render dashboard. The database and web service must share an account and region. Never commit or paste this value into chat. |
| `HOST` | Set to `0.0.0.0`, or leave unset on Render. The app detects `RENDER=true` and uses this binding. Remove any explicit `127.0.0.1` value. |
| `PORT` | Use Render's injected value; do not replace it with the PostgreSQL port. |
| `PGSSLMODE` | For the internal URL, leave unset if the URL has no SSL options, or set `require` to require TLS. Render internal TLS uses self-signed certificates, so `require` encrypts without certificate verification. |
| `CANDIDATE_ID` | `08` |
| `MQTT_ENABLED` | Keep your intended setting: `true` enables the existing worker; `false` disables it. |
| `MQTT_BROKER_URL` | Keep the existing assessment broker setting if MQTT is enabled. |

`DATABASE_URL` takes precedence over `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`. Those individual variables remain supported when no URL is supplied. Do not put a full URL into `PGHOST` or `HOST`.

SSL options embedded in `DATABASE_URL` take precedence over `PGSSLMODE`. For an external URL with a publicly trusted certificate, prefer `sslmode=verify-full` or `PGSSLMODE=verify-full`. `require` follows PostgreSQL/libpq semantics: TLS is required, but certificate verification is not performed unless a root certificate is supplied. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## What changed

The previous implementation ignored `DATABASE_URL`, so a URL-only deployment attempted localhost with development credentials. It also defaulted HTTP to loopback and lacked explicit database SSL configuration. The fix adds URL support, SSL mode handling, and Render-aware HTTP binding while keeping local PG-variable configuration working.

Startup now checks connectivity before migrations, identifies the failing stage, and logs a safe error code and explanation. Migration errors identify the numbered SQL filename. Driver messages, SQL details, credentials, hostnames, and connection URLs are excluded from these diagnostics.

The existing migrations remain unchanged. Startup runs them transactionally; fresh initialization and repeated startup were verified against an isolated PostgreSQL database using a Render-style URL with deliberately incorrect individual PG variables. Use the supplied database role that owns its schema; missing schema permissions appear as code `42501` rather than a generic startup message.

## Deploy and verify

1. Save the environment settings in Render and deploy the latest `main` commit.
2. Confirm startup announces HTTP on `0.0.0.0` and the assigned port.
3. Open `/api/health` on your Render service URL; expect `status: ok` and `database: connected`.
4. Open the existing dashboard and verify MQTT according to your configured setting.

The actual hosted database and deployment have not been accessed from this workspace. If a redeploy still fails, the new stage/code identifies whether it is connectivity, authentication, migration permissions, TLS, or HTTP binding; share only those sanitized log lines.

Validation: `npm test` passed 61 tests, covering the existing production/REST/MQTT behavior and new connection configuration, SSL option resolution, sanitized diagnostics, failed startup, and repeated Render-style initialization. TLS configuration was checked through the PostgreSQL driver's resolved options; no hosted TLS connection or Render redeploy was performed from this workspace.

References: [Render PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting), [Render web service binding](https://render.com/docs/web-services), [node-postgres SSL](https://node-postgres.com/features/ssl).
