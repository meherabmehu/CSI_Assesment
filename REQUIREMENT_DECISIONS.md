# Requirement Decisions

This document records the implementation decisions made where the original FSE-01 assessment contains conflicting or incomplete instructions. These are documented interpretations, not examiner-approved clarifications. The later change request extends the existing application.

## Conflicting requirements

| Requirement conflict | Decision | Reason and resulting behavior |
| --- | --- | --- |
| Page 3 requires globally unique event IDs; page 5 suggests `(source_id, event_id)` uniqueness. | Use globally unique `event_id`. | VOID targets and ACK requests identify events by event ID alone. A global ID makes those operations unambiguous. Reusing an ID with different source or business data returns CONFLICT and preserves the original event. |
| Pages 3–4 permit valid items in a batch to succeed; page 5 suggests rolling back on validation failure. | Preserve partial success for normal validation/business rejections. | Evaluate items in order and record every result in one transaction. REJECTED items do not undo valid siblings. Unexpected database or program failures roll back the entire transaction. |
| Page 4 allows acknowledgement of completed COUNT/VOID events; page 6 says completed VOIDs are automatically acknowledged and pending review contains COUNTs. | Automatically acknowledge completed VOIDs. | Follow the final factory workflow. COUNTs require manual acknowledgement. An ACK request for an already completed VOID returns ALREADY_ACKED. |

## Additional decisions

- Register previously unknown valid production sources when a logical event is stored. A source with only rejected submissions can still be entered into the dashboard filter.
- Treat an empty event array as a successful no-op.
- Trim event/source IDs and normalize timestamps and optional fields before comparing retries. Extra fields are retained in submission history but do not change business identity.
- Resolve VOID-before-COUNT automatically when the target arrives. The first stored eligible VOID wins; later corrections cannot reverse the same count again.
- Acknowledgement records review, so it does not prevent a later valid VOID. Reversing a COUNT does not remove its history or automatically acknowledge that COUNT.
- Use the same event-processing functions for REST and MQTT. The frontend displays backend values rather than calculating production totals.
- MQTT challenge state represents the whole factory. The dashboard's selected source filters its summary and event views.
- Exact retries of completed MQTT challenges return the stored original response without processing events again. Their original expiry does not trigger new processing.
- Shift entities, authentication/roles, and deployment infrastructure are outside the mandatory implemented scope. The optional Protocol Buffers bonus is not implemented.

## Later change request

- New COUNT submissions require integer quantities from **1 to 500**, inclusive. COUNT 450 is accepted; COUNT 501 is REJECTED with a reason and a persisted submission attempt. Rejected counts do not increase production.
- `rejected_submissions` counts PostgreSQL submission attempts classified REJECTED, with the existing optional `source_id` filter. DUPLICATE, CONFLICT, and PENDING_REFERENCE attempts are excluded. A pending VOID later rejected during resolution does not retroactively change its original submission classification.
- Keep the six existing summary fields and add the seventh field to new MQTT challenge responses and the dashboard.
- Preserve existing accepted records and stored MQTT responses. Previously completed challenges retain exact replay behavior.
- Extend the existing modular monolith and APIs; no rebuild or separate service is needed.

## Verification scope

The updated application passed 55 automated tests and 20 browser checks. Windows launcher startup, shutdown, restart, and a real local MQTT demonstration were also checked. External assessment-broker verification remains pending; local broker evidence does not establish external connectivity.

See [TECHNICAL_EXPLANATION.md](TECHNICAL_EXPLANATION.md) for function ownership and transaction details, and [CHANGE_REQUEST.md](CHANGE_REQUEST.md) for the change request implementation and demonstration.
