# Technical explanation

## Problem and boundaries

Counters can retry, deliver events out of order or report incorrect production. The system must compute a trustworthy total while preserving every submission, correction and review. One Node.js/Express application serves the frontend, three required HTTP APIs and an outbound MQTT worker. All modules share one PostgreSQL database and deploy together.

```
HTTP routes ─┐
             ├─ validateEvent → processEventsInTransaction → PostgreSQL
MQTT worker ─┘                                  │
                                      commit → domain callbacks
State queries → committed PostgreSQL evidence → HTTP/MQTT response
ACK service → review state + audit record
```

## Entities

- `production_sources`: a line or machine. Unknown valid source IDs are registered on first accepted/logical event.
- `production_events`: one logical event identified by a globally unique event ID; normalized business payload, event time, receipt time, status, completion time and acknowledgement information.
- `submission_attempts`: every received event item, original serialized JSON in `raw_payload_text`, safe JSONB projection, supplied IDs where useful, classification, failure reason, transport, challenge ID and receipt time. Validation failures exist here even when no logical event can be created. Unsupported Unicode/deep JSON is still preserved as escaped TEXT while its projection remains PostgreSQL-safe.
- `mqtt_challenges`: original request, canonical request digest, original serialized response, status and delivery evidence. This is also a small persistent response outbox.
- `audit_log`: accepted counts, pending/applied/resolved/rejected VOID events, review actions and challenge processing/conflicts.

A logical invalid VOID with valid fields is retained as REJECTED. Malformed events are attempts only. No records are deleted by an ACK or VOID. A pending VOID cannot have a target foreign key because its target is allowed to arrive later. Source IDs do have a foreign key. `ingestion_order` is a database-generated sequence that decides which pending VOID was stored first, including within one batch.

## Function ownership

| Module | Functions / responsibility |
|---|---|
| events | `validateEvent`, `processCount`, `processVoid`, `resolvePendingVoids`, `processEventsInTransaction`, repositories |
| ack | `acknowledgeEvents`, repeat-safe review markers |
| state | `getSummary`, `getPending`, `getExceptions`, `getHistory`, consistent dashboard snapshot |
| mqtt | `validateChallenge`, `handleChallenge`, worker lifecycle and transport |
| audit | `recordAudit` append-only activity records |
| shared | configuration, PostgreSQL pool/transactions, canonical JSON, domain callbacks |

Routes validate only request envelopes and delegate to services. COUNT/VOID logic is not repeated in routes, worker or browser. The browser displays server values; it never computes factory totals.

## Normalization and retry identity

Event IDs and source IDs are trimmed, type remains case-sensitive, omitted optional fields become null, timestamps become UTC ISO strings and quantities remain integers. Unknown fields are ignored for event identity but preserved in raw submission history. A positive COUNT quantity must fit PostgreSQL's integer column. Timestamp validation checks calendar validity and explicit timezone, preserving fractional precision in normalized identity. Stored payloads are normalized again before comparing so older millisecond-formatted records remain duplicate-safe. NUL/unpaired Unicode and more than 64 JSON levels are rejected as normal item outcomes; oversized/unsupported IDs are not used in indexed history columns.

The globally unique event ID selects the original logical event. Equal canonical normalized payload means DUPLICATE, including retries of pending or rejected logical events. Different normalized data means CONFLICT. Neither retry changes the original. All attempts are stored. MQTT challenge identity instead includes the complete canonical envelope/body; a changed request under the same challenge ID is a CHALLENGE_CONFLICT.

## Transactions and concurrency

Every write service obtains one PostgreSQL client, begins a transaction and takes advisory transaction lock `7030101`. This deliberately serializes writes for a small assessment application. It prevents concurrent retries, corrections and reviews from reading inconsistent target state. Global event primary keys and the partial unique index on accepted VOID targets provide a second layer of protection. This is intentionally simpler than per-aggregate locks; write throughput is limited by the global lock.

All valid and invalid items in a batch are evaluated in order and committed together, including attempt history. Validation and business rejection are normal outcomes, so they do not abort the transaction or undo valid siblings. An unexpected database/program error rolls back the whole transaction. No network operation is inside a database transaction. MQTT processing stores events, audit records, six-field state and its response atomically before publishing.

Read snapshots use repeatable-read, read-only transactions. Total production is the sum of accepted COUNT quantities minus the original quantities referenced by accepted VOID events. It is calculated from durable evidence, never an in-memory counter. `processed_events` includes completed COUNT and VOID records; unresolved or rejected events are excluded. Pending ACK counts completed events lacking an acknowledgement (completed VOIDs receive automatic acknowledgement).

Duplicate/conflict summary filters use the source supplied in the attempt, not the original event's source. Attempts without a useful source appear only in unfiltered exceptions. List endpoints return the latest 200 records while summary queries cover all records.

## Out-of-order corrections

A valid VOID with no target is stored as PENDING_REFERENCE. Any newly inserted logical event triggers resolution of pending references to its ID. If the target is an accepted COUNT on the same source, the first stored eligible VOID applies and automatically receives ACK. Other pending VOIDs are rejected because that COUNT was already reversed. Wrong-source or non-COUNT targets reject their pending VOIDs with reasons. The original pending submission classification is retained as historical evidence; current logical status and audit records describe the later resolution.

Batch item results describe each item at its processing point. Therefore a VOID-before-COUNT can return PENDING_REFERENCE even though it resolves later in the same batch. Subsequent state reflects the completed resolution.

## ACK and notifications

ACK stores a timestamp/method and audit action. The first occurrence returns ACKED; the next occurrence returns ALREADY_ACKED, even within one request. Incomplete/rejected logical records return NOT_READY; absent logical IDs return NOT_FOUND. An ACK does not block a future correction. Completed VOIDs are automatically acknowledged but remain accessible through the ACK API as ALREADY_ACKED.

EVENT_ACCEPTED, VOID_RESOLVED, VOID_REJECTED and EVENT_ACKNOWLEDGED callbacks are emitted only after successful commit. They are best-effort in-process notifications; restart-safe state comes from PostgreSQL. A listener cannot roll back committed business work. The dashboard currently polls consistent read snapshots.

## MQTT lifecycle and trace

Candidate ID is explicitly confirmed as **08**. Only `fse-01/08/{challenge,response,status}` is used. Worker client IDs follow `fse01-08-<random suffix>`. MQTT candidate identity is transport metadata and is never part of event identity.

1. Connect outbound to the broker, subscribe with QoS 1, publish ONLINE.
2. Parse and validate protocol 1.0, candidate ID, challenge ID, PROCESS_EVENTS, timezone-aware sent/expiry timestamps and events array.
3. Under the write transaction lock, look up challenge ID. Identical requests replay the original response; changed requests fail and preserve the original.
4. Reject expired/mismatched new challenges before processing their events. Run ordered event processing through the shared service.
5. Read six summary fields and store the original response in the same transaction. Commit, then publish the correlated JSON with QoS 1 and retain false.
6. Record successful broker transport delivery. On reconnect, republish stored responses lacking recorded delivery. Duplicate responses are harmless because challenge IDs correlate them.

Reconnect uses an explicit increasing timer capped at 30 seconds and resubscribes. Subscription/PUBACK waits have a five-second deadline; persisted responses own retry recovery rather than an unbounded client delivery queue. Recovery runs in candidate-filtered batches on connect and after heartbeats. Heartbeat interval is 30 seconds. Graceful shutdown attempts OFFLINE within the deadline; last will covers an ungraceful disconnect. Dashboard connectivity is runtime state; challenge history and counts survive restart. Malformed messages clear the last challenge identity instead of attaching their failure to an older request. Broker credentials are omitted from monitoring output. New expired requests fail; already completed exact replays return the original response even after the original deadline because they perform no new business processing. Candidate routing is checked before any replay; a foreign candidate is audited but cannot reserve a challenge ID. Requests are processed as promptly as possible, but broker/network outages cannot guarantee delivery before expiry; the persisted response remains recoverable.

Stable failure codes: VALIDATION_ERROR, CANDIDATE_MISMATCH, UNSUPPORTED_PROTOCOL, CHALLENGE_EXPIRED, CHALLENGE_CONFLICT, INTERNAL_ERROR. No SQL credentials or stack traces are returned. The simulator must receive the correct matching response; PUBACK alone proves transport delivery only.

## Explicit brief inconsistencies and assumptions

The supplied scanned assessment contradicts itself in three places. No examiner clarification was available in this session; these decisions are recorded rather than silently treating all statements as compatible.

| Conflict | Chosen behavior and reason |
|---|---|
| Page 3 says event IDs are globally unique; page 5 proposes `(source_id,event_id)` uniqueness | Globally unique `event_id`, following the event contract. VOID targets and ACK inputs only carry event ID, so global identity avoids ambiguity. |
| Pages 3–4 allow valid batch siblings to succeed; page 5 says validation failure rolls back the batch | Partial semantic success, following explicit API/business rules. All outcomes commit in one transaction; only unexpected failures roll back. |
| Page 4 allows completed COUNT/VOID acknowledgement; page 6 says VOIDs auto-ACK and pending review shows COUNTs only | Auto-ACK completed VOIDs, following the final factory workflow note. The ACK API still accepts VOID IDs and returns ALREADY_ACKED. |

Other assumptions: source names may be registered from incoming valid events; an empty event array is a valid no-op; extra event fields do not affect business identity; there is no shift entity because per-shift dashboards are described as a future requirement. Completed counts remain reviewable after reversal if not previously acknowledged. Authentication, roles, deployment infrastructure and Protocol Buffers bonus are outside the mandatory first version.

## Restart behavior and future services

Events, attempts, review markers, pending references and original challenge responses are in PostgreSQL. Restart reconstructs totals via queries and restores challenge history. MQTT reconnects automatically. Tests use disposable databases and local brokers; no main database reset is needed.

A credible migration path is to extract the events service first while keeping one owner of COUNT/VOID rules and event tables. HTTP and MQTT would call that service through an explicit contract. The MQTT module could then become an independent worker owning challenge/delivery records, with event IDs and challenge IDs preserving idempotency across network retries. Add a transactional outbox for durable domain events; a state service consumes those events into a replayable projection and an ACK service owns review records. Replace the global lock with narrowly scoped aggregate locks and consistent target/event lock ordering. Version schemas/contracts before splitting storage. Kafka/RabbitMQ/Kubernetes are unnecessary for the present single deployment.

## Verification

51 automated tests exercise the required five cases plus normalization/upgrades, fractional timestamp precision, Unicode/deep/oversized input, conflicts, source filtering, concurrent retries/corrections, rollback, committed callbacks, restart reads, API semantics, client timeouts, startup cleanup, candidate/recovery isolation, real local MQTT response delivery, shutdown deadlines, simulator timeout, heartbeat and broker reconnect. 15 browser checks cover desktop/mobile display, submission, duplicate, correction targets, ACK, exceptions, source filtering, invalid JSON, empty search, stalled mutations and backend failure. Screenshots and machine-readable evidence are in `artifacts/`.
