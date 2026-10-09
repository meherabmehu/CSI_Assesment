# NorthBridge Production Desk

A working factory dashboard that accepts production counts, safely ignores repeated deliveries, reverses incorrect counts without deleting history, and lets a supervisor acknowledge reviewed events. HTTP and MQTT use the same business functions and one PostgreSQL database.

## Requirements

- Node.js 22 or newer (developed and verified with Node.js 24).
- PostgreSQL (verified with PostgreSQL 16).
- PostgreSQL login able to create the project database; automated tests also create disposable test databases.
- Network access to the assessment MQTT broker for the live device demo.

No frontend build step is needed. Express serves the HTML/CSS/JavaScript dashboard and APIs in one deployment.

## Setup and run

```powershell
git clone https://github.com/meherabmehu/CSI_Assesment.git
cd CSI_Assesment
npm ci
Copy-Item .env.example .env
```

Edit `.env`, set your PostgreSQL password and confirm `CANDIDATE_ID=08`. Keep an existing configured `.env`; do not overwrite it with the example.

```powershell
npm run db:create
npm start
```

Open **http://127.0.0.1:3000**. The startup command applies the idempotent table migration automatically. Stop with Ctrl+C. For development use `npm run dev`. To apply the migration on an existing database use `npm run db:init`.

| Setting | Default / purpose |
|---|---|
| `PGHOST`, `PGPORT` | `localhost`, `5432` |
| `PGUSER`, `PGPASSWORD` | PostgreSQL login; password is local only |
| `PGDATABASE` | `cis_assessment` |
| `HOST`, `PORT` | `127.0.0.1`, `3000` |
| `MQTT_ENABLED` | `true`; set `false` for a REST-only offline run |
| `MQTT_BROKER_URL` | `mqtt://152.42.238.142:1883` |
| `CANDIDATE_ID` | `08`, confirmed by the candidate |

`.env` is ignored by Git. Use quoted dotenv values if your password contains `#` or surrounding whitespace. `.env.example` contains no credentials. The included PowerShell connection helper is optional; the Node setup command is the normal setup path.

## Dashboard workflow

1. Choose **Count +5**, then **Submit event**. Net production and pending review update from the real backend.
2. Submit the exact same JSON again. The result is `DUPLICATE`; production stays unchanged.
3. Choose **Correction**, then submit. It reverses the last count. Its history remains visible.
4. **Batch example** demonstrates a VOID before its COUNT, a successful count, a duplicate and an invalid item.
5. Select pending rows and acknowledge them. Counts leave pending review; the total is unchanged.
6. Open **Exceptions** for unresolved references, rejected submissions and conflicts. **History** records every event submission attempt, including duplicates.
7. See the MQTT connection, employee ID, challenge counts and matching response on the right. Expand **View latest response** to inspect the actual correlated JSON.

Enter a production source and choose Apply to filter the event views and summary. Choose Clear to see all sources. MQTT challenge state always represents the whole factory. The dashboard refreshes every five seconds and after mutations. Lists show the latest 200 records; summary values count all stored records. All times are rendered in the browser's local timezone.

## REST examples

Use these JSON bodies in Postman or the dashboard. On a repeated run choose fresh IDs to get new events.

### `POST /api/events`

Accepts an object or an array. A well-formed event envelope returns HTTP 200 with ordered item results, even when an item is rejected. A scalar/null top-level request or malformed JSON returns HTTP 400. Body limit: 1 MB; batch limit: 500 items.

```json
{"source_id":"LINE-01","event_id":"EV-101","type":"COUNT","quantity":5,"event_time":"2026-10-09T10:30:00Z"}
```

```json
{"results":[{"event_id":"EV-101","status":"ACCEPTED","message":"Production count recorded."}]}
```

Duplicate: resubmit the exact object. Conflict: resubmit `EV-101` with quantity 10. Correction:

```json
{"source_id":"LINE-01","event_id":"EV-102","type":"VOID","target_event_id":"EV-101","event_time":"2026-10-09T10:31:00Z"}
```

Out-of-order and mixed batch:

```json
[
  {"source_id":"LINE-02","event_id":"EV-EARLY-VOID","type":"VOID","target_event_id":"EV-LATE-COUNT","event_time":"2026-10-09T10:32:00Z"},
  {"source_id":"LINE-02","event_id":"EV-LATE-COUNT","type":"COUNT","quantity":7,"event_time":"2026-10-09T10:31:00Z"},
  {"source_id":"LINE-02","event_id":"EV-INVALID","type":"COUNT","quantity":-1,"event_time":"2026-10-09T10:33:00Z"}
]
```

Results follow submitted order: `PENDING_REFERENCE`, `ACCEPTED`, `REJECTED`. The first result describes that submission's immediate outcome; its stored VOID is automatically resolved when the next COUNT arrives.

### `GET /api/state`

```text
/api/state?view=summary
/api/state?source_id=LINE-01&view=pending
/api/state?view=exceptions
/api/state?view=history
```

Summary example after one fresh COUNT +5:

```json
{"net_total":5,"processed_events":1,"pending_ack":1,"unresolved":0,"duplicates":0,"conflicts":0,"rejected_submissions":0}
```

Pending, exceptions and history return `{ "events": [...] }`. Extra convenience endpoints: `/api/dashboard` returns a consistent snapshot plus MQTT monitoring; `/api/health` verifies database connectivity.

### `POST /api/ack`

```json
{"event_ids":["EV-101","EV-101","MISSING-ID"]}
```

For a fresh completed COUNT, results are `ACKED`, `ALREADY_ACKED`, `NOT_FOUND` in that order. Unresolved or rejected logical events return `NOT_READY`. Completed VOID corrections are automatically acknowledged; submitting their IDs here returns `ALREADY_ACKED`.

## MQTT connection and simulation

MQTT 3.1.1, QoS 1, retain false. Use only the assigned employee/candidate namespace:

| Direction | Topic |
|---|---|
| Subscribe | `fse-01/08/challenge` |
| Publish response | `fse-01/08/response` |
| Publish connection status | `fse-01/08/status` |

The worker sends ONLINE after subscribing, HEARTBEAT every 30 seconds and OFFLINE on shutdown or via its last will. It reconnects with backoff and resubscribes. It stores challenge responses before publishing, reuses the original response for identical retries, and recovers responses whose successful delivery was not recorded.

With the application running, use another terminal:

```powershell
npm run simulate
```

This optional simulator publishes a fresh challenge to **your own `08` topic** and waits for a matching response. It sends COUNT +5, its duplicate and a VOID on `DEMO-LINE`: net production is unchanged, but the demo leaves traceable history and one COUNT ready for supervisor review. It writes the live request/response evidence to `artifacts/mqtt-live-verification.json`. It is a protocol-compatible smoke test, not the examiner's simulator.

To send a custom challenge: `npm run simulate -- path/to/challenge.json`. Supply current `sent_at` and `expires_at`; an old sample will expire.

```json
{
  "protocol_version":"1.0","candidate_id":"08","challenge_id":"CH-EXAMPLE","command":"PROCESS_EVENTS",
  "sent_at":"2026-10-09T10:45:00Z","expires_at":"2026-10-09T10:45:15Z",
  "events":[{"source_id":"LINE-01","event_id":"EV-MQTT-1","type":"COUNT","quantity":5,"event_time":"2026-10-09T10:44:00Z"}]
}
```

A response includes matching `challenge_id`, status `COMPLETED`, ordered `results` and all seven `state` fields. Invalid individual events may be `REJECTED` while the challenge is `COMPLETED`. Envelope failures return `FAILED`, `error_code` and `message`. MQTT PUBACK alone does not establish business success; the correlated application response does.

## Tests and evidence

```powershell
npm test
npm run test:browser
```

The automated suite has **55 tests**, including the five required cases, timestamp precision and upgrade compatibility, Unicode/deep-input isolation, races, partial batches, transactions, API errors, startup cleanup, client timeouts, real local MQTT transport, candidate validation, replay, shutdown deadlines, heartbeat and broker restart. MQTT tests use a disposable Aedes broker and do not contact the assessment broker. Every test database has a generated `cis_assessment_test_*` name and is dropped after testing; the main project database is never truncated.

Browser verification covers 20 end-to-end checks using a disposable PostgreSQL database, a real local MQTT broker and headless Edge/Chromium. On Windows it uses installed Edge. Otherwise install Chromium with `npx playwright install chromium`, or set `BROWSER_PATH` to a Chromium-compatible executable. It generates desktop/mobile/exception/API/MQTT screenshots and `artifacts/browser-verification.json`. Screenshot values are isolated test fixtures, not factory production.

Inputs containing NUL/unpaired Unicode or more than 64 JSON levels are rejected without undoing valid batch siblings. Exact serialized submission JSON is retained in a TEXT history column alongside a safe JSONB projection. Frontend mutations time out after 15 seconds with an explicit unknown-outcome message; retry with the same IDs. See [artifacts/BUG_REVIEW.md](artifacts/BUG_REVIEW.md) for the bug audit and regression evidence.

## Architecture and submission

Read [TECHNICAL_EXPLANATION.md](TECHNICAL_EXPLANATION.md) for entity boundaries, transactions, normalization, unresolved references, the three brief inconsistencies and a future services migration plan. Read [RUN_GUIDE_BN.md](RUN_GUIDE_BN.md) for a short Bengali walkthrough. AI use and the curated relevant conversation record are disclosed in [AI_USAGE.md](AI_USAGE.md) and [AI_CONVERSATION.md](AI_CONVERSATION.md).

After all source changes are committed:

```powershell
npm run package
```

This archives the committed source to `artifacts/source.zip`, including documentation and evidence. It excludes `.env`, Git history, dependencies, caches and the ZIP itself. Submit the GitHub URL, ZIP and screenshots through the examiner's Google Form. The form URL and deadline were not included in the supplied PDF; obtain those from the examiner.

## Troubleshooting

- Database login error: confirm PostgreSQL is running and `PGPASSWORD` matches the installed login. Run `npm run db:create`.
- Port in use: change `PORT` in `.env`, then restart; use the new port in the browser.
- MQTT reconnecting: confirm internet access and the broker address; REST/dashboard remain usable while MQTT reconnects.
- No simulator response: the backend must be running with MQTT enabled, connected, and using the exact employee ID `08`.
- Git ownership error on this Windows workspace: use `git -c safe.directory=D:/Project/CIS_Assesment status` (the path is scoped to this repository).

Library references: [Express API](https://expressjs.com/en/5x/api/), [node-postgres transactions](https://node-postgres.com/features/transactions), [MQTT.js](https://github.com/mqttjs/MQTT.js). No cloud deployment or sign-in system is required by the assessment; the app listens on loopback by default.

## Change request

COUNT accepts integer quantities from 1 to 500. The summary includes `rejected_submissions`, counted from PostgreSQL submission attempts with status REJECTED. Enter a source in the dashboard and choose Apply, or Clear to view all sources. See [CHANGE_REQUEST.md](CHANGE_REQUEST.md) for the changed functions and demo evidence.
