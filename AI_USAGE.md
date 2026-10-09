# AI Usage

Tool: OpenAI Codex

This is a concise, reconstructed development conversation based on the project requirements and completed work. It shows the workflow and scope of AI assistance rather than a verbatim chat transcript.

## 1. Understand the requirements

**User:** Read the assessment and outline the main features. Flag any conflicting requirements before writing code.

**Assistant:** The app needs COUNT/VOID processing, submission history, acknowledgements, production summaries, a dashboard, and MQTT challenge responses. The brief conflicts on event uniqueness, batch rollback, and VOID acknowledgement. I will document those decisions in REQUIREMENT_DECISIONS.md.

## 2. Choose the structure

**User:** Keep the architecture simple. Use separate modules and share the business rules between REST and MQTT.

**Assistant:** Use Node.js, Express, PostgreSQL, and MQTT.js with an HTML/CSS/JavaScript frontend. A modular monolith keeps one deployment and database, with separate event, state, acknowledgement, audit, and MQTT modules.

## 3. Set up PostgreSQL

**User:** PostgreSQL is installed. Set up the connection and tables. Keep credentials out of Git.

**Assistant:** Store connection settings in the ignored .env file. Create tables for production events, submission attempts, sources, acknowledgements, audit history, and MQTT challenges. Keep processing and its history in the same transaction.

## 4. Implement event processing

**User:** Implement COUNT, VOID, duplicates, and conflicts. Handle a VOID that arrives before its COUNT.

**Assistant:** COUNT adds production once. An identical retry returns DUPLICATE; changed data under the same ID returns CONFLICT. VOID reverses a same-source COUNT once. An early VOID stays pending and resolves when its target arrives. Every attempt is recorded.

## 5. Add APIs and reviews

**User:** Add the required APIs and acknowledgement flow. Keep valid batch items when another item is rejected.

**Assistant:** POST /api/events processes items in order, GET /api/state returns the requested view, and POST /api/ack records review. Normal rejections do not undo valid siblings; unexpected failures roll back the transaction. Completed VOIDs are automatically acknowledged.

## 6. Add MQTT

**User:** Use employee ID 08. Process challenges through the same event service and handle retries safely.

**Assistant:** Use the fse-01/08 topic namespace. Validate challenge metadata, process events, and persist the matching response before publishing. Exact retries return the stored response. Add heartbeats, reconnect handling, and recovery of unpublished responses.

## 7. Build the dashboard

**User:** Build a responsive dashboard using real backend data. Include pending reviews, exceptions, event submission, and MQTT status.

**Assistant:** The dashboard loads the production summary and event views, supports acknowledgement and JSON submission, and shows MQTT challenge results. Add useful loading, empty, error, and stale-data messages.

## 8. Test and fix bugs

**User:** Review the implementation carefully. Test edge cases and fix any bugs you find.

**Assistant:** Check transaction rollback, concurrent retries, VOID resolution, timestamp normalization, malformed input, MQTT recovery, and request timeouts. Use temporary PostgreSQL databases, a local MQTT broker, and browser checks so tests do not reset the project database.

## 9. Apply the change request

**User:** Update the existing app: limit COUNT quantities to 1?500, add rejected_submissions, and filter Summary, Pending, and Exceptions by source. Keep earlier functionality working.

**Assistant:** Extend the shared validator and summary query. Count persisted REJECTED submission attempts, excluding duplicates, conflicts, and pending references. Add a source input with Apply/Clear and a separate seventh indicator. COUNT 450 is accepted; 501 is rejected without increasing production.

## 10. Verify and prepare the submission

**User:** Verify the changes, prepare a local demo, and push meaningful commits. Keep the documentation clear and short.

**Assistant:** The updated app passed 55 automated tests and 20 browser checks. Local startup, shutdown, restart, and MQTT challenge/response were also verified. Commit changes by feature and document decisions and evidence. External assessment-broker verification remains pending; the optional Protocol Buffers bonus is not implemented.

## Scope of assistance

AI assisted with requirement analysis, implementation, debugging, tests, documentation, and Git commits. The user supplied the assessment, repository, database settings, and employee ID. Credentials and tool logs are excluded from this record.
