# PostgreSQL Initialization and Migrations

## Prerequisites

- Node.js 22 or newer and npm.
- A running PostgreSQL server. This project was verified with PostgreSQL 16.
- A PostgreSQL account that can connect, create tables, and alter the project schema. Automatic database creation also requires CREATEDB permission.

Run the following commands from the project root.

## 1. Install dependencies

```powershell
npm ci
```

## 2. Configure the connection

If `.env` does not exist, create it from the template:

```powershell
Copy-Item .env.example .env
```

If `.env` already exists, edit it without overwriting your current settings. Set these values to match your local PostgreSQL installation:

```dotenv
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_local_password
PGDATABASE=cis_assessment
```

Enter the actual password locally. `.env` is ignored by Git and must not be submitted. Database names used by the automatic setup must begin with a lowercase letter and contain only lowercase letters, digits, and underscores, with a maximum length of 63 characters.

## 3. Create and initialize the database

```powershell
npm run db:create
```

This command connects to the existing `postgres` maintenance database, creates `PGDATABASE` if it is missing, and applies the migration files. Existing project data is preserved.

Expected output:

```text
Database cis_assessment and its tables are ready.
```

If your account cannot create databases, have an administrator create the database and grant the configured account ownership or the necessary schema permissions. Then run:

```powershell
npm run db:init
```

`db:init` requires the configured database to exist; it does not create it.

## 4. Apply migrations to an existing database

```powershell
npm run db:init
```

The migration runner reads numbered SQL files from `migrations/` in filename order and executes them in one transaction under the shared transaction lock. An unexpected SQL error rolls back that migration transaction.

| File | Purpose |
| --- | --- |
| `migrations/001_initial.sql` | Creates production sources, events, submission attempts, MQTT challenges, audit records, and their indexes/constraints. |
| `migrations/002_raw_json_history.sql` | Adds original serialized submission/request TEXT columns and backfills existing rows. |

The current migrations can be run repeatedly: they use guarded schema changes and only backfill missing values. There is no migration-version table; all numbered files are evaluated on every run. New migrations must account for this behavior. Automatic down migrations are not provided.

Application startup also applies these migrations before opening the HTTP server. The quantity limit and rejected-submission indicator in the change request use existing tables and do not require another migration.

## 5. Verify the connection

Start the app with a local MQTT broker:

```powershell
npm run start:local
```

In another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:3000/api/state
```

The health response should contain `status: ok` and `database: connected`. The state endpoint returns the production summary, including `rejected_submissions`. An empty database returns zero for each metric. Stop the app with Ctrl+C.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Connection refused or timeout | PostgreSQL service is running; `PGHOST` and `PGPORT` match the server. |
| Password authentication failed | `PGUSER`, `PGPASSWORD`, and PostgreSQL authentication settings. |
| Permission denied to create database | Use an account with CREATEDB, or create the database through an administrator and run `db:init`. |
| Database does not exist | Run `db:create`, or create the configured database before `db:init`. |
| Permission denied on schema/table | The configured account can create and alter objects in the project database. |

Back up an existing deployment before applying future schema changes. Initialization does not reset the database or insert demo production. Automated tests use separate temporary databases; do not manually truncate the project tables to run the tests.
