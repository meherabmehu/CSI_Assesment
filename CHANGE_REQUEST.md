# Change Request Implementation

The photographed change request extends the existing FSE-01 application. No rebuild or new service was needed.

| Requirement | Implementation |
| --- | --- |
| COUNT quantity must be an integer from 1 to 500 | `validateEvent` in `src/modules/events/validation.js`; REST and MQTT already share this validator |
| Reject invalid quantities with a clear reason and PostgreSQL history | Existing event service records every attempt; rejected counts do not create accepted production |
| Add `rejected_submissions` | `getSummary` in `src/modules/state/queries.js` counts persisted REJECTED submission attempts |
| Support source filtering and return zero when empty | Existing optional `source_id` applies to the new count, including sources with only rejected attempts |
| Include the field in MQTT state | The existing challenge service calls the same summary function |
| Source input, apply and clear | `frontend/index.html` and `frontend/app.js` use the existing dashboard API |
| Seventh responsive indicator | A separate warm-colored rejected-submissions card, refreshed with the other metrics |

The six original summary fields retain their names and calculations. DUPLICATE, CONFLICT, and PENDING_REFERENCE attempts are excluded from rejected submissions. A previously pending VOID that later becomes a rejected logical event is also excluded unless a submission attempt itself was classified REJECTED.

Existing accepted events are preserved. The new quantity rule applies to new submissions; existing COUNT/VOID processing and transaction boundaries are unchanged. Previously stored MQTT responses retain exact replay behavior; newly processed challenges include the seventh field.

## Verification and demonstration

- `npm test`: 55 tests, including quantity boundaries, REST/MQTT parity, persistent counts through a fresh database connection, source filtering, and rejection classification.
- `npm run test:browser`: 20 checks, including the 450/501 demonstration, all affected views, zero/empty states, clear-to-all behavior, errors, and mobile overflow.
- `artifacts/change-request-source.png`: the filtered CR-LINE demonstration with accepted production of 450 and one rejected submission.
- `artifacts/browser-verification.json`: generated local verification evidence.

For a manual demonstration, submit COUNT 450 and COUNT 501 with different event IDs and the same source. Apply that source, inspect the seven metrics and Exceptions, then clear the filter. Production stays at 450 and rejected submissions shows 1 for that source. Use fresh IDs when repeating the demonstration; accepted retries are duplicates, while rejected submissions are counted per stored attempt.

The architecture remains a function-based modular monolith. Existing event validation, attempt persistence, summary queries, and frontend rendering were extended. PostgreSQL transactions, VOID resolution, acknowledgements, and duplicate/conflict rules remain covered by the regression suite.
