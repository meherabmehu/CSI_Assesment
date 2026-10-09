# Verification evidence

Verified on 9 October 2026, Asia/Dhaka.

- `npm run db:create`: project database and tables ready on PostgreSQL 16.
- `npm test`: **51 passed, 0 failed**, including PostgreSQL concurrency, VOID-before-COUNT, safe ACK, transaction rollback, legacy retry compatibility, malformed input isolation, candidate/recovery checks, shutdown/startup cleanup, MQTT replay, actual local broker delivery, 30-second heartbeat and broker restart/resubscribe.
- `npm run test:browser`: **15 workflow checks passed**; no JavaScript errors, desktop/390px mobile layouts, correction targeting and stalled submissions verified.
- Main application health: local backend and PostgreSQL respond; no test fixtures were inserted into the main database.
- Candidate/employee identity: **08**, explicitly confirmed by the user.

## Evidence files

| File | Evidence |
|---|---|
| `dashboard-desktop.png` | Responsive desktop dashboard populated from isolated PostgreSQL fixtures |
| `dashboard-mobile.png` | 390px mobile layout |
| `dashboard-exceptions.png` | Unresolved reference, conflict and rejected item views |
| `rest-api-response.png` | Real GET state response in a browser |
| `mqtt-response.png` | Real local-broker challenge, matching response and six-field state |
| `browser-verification.json` | Health, state, MQTT response and named browser checks |

These screenshot totals come from isolated test data, not real factory production. Each temporary test database was dropped after verification. No tests truncate the project's main database.

## External integration boundary

The MQTT implementation is configured for the PDF broker `152.42.238.142:1883` and the `fse-01/08/*` namespace. Real MQTT transport has been verified against a local broker. An external assessment-broker run has **not** been performed: automatic approval review requested explicit permission before sending database-derived event results and summary counts to that destination. The running local application was started with external MQTT disabled while that permission is pending.

The user's confirmed employee ID is not by itself evidence that the remote broker accepted a session. Do not present local screenshots as examiner-broker evidence. After approval and a successful live run, `npm run simulate` generates `mqtt-live-verification.json` with the actual external request and correlated response.
