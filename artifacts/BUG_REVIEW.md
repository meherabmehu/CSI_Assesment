# Bug review and fixes

The user requested a thorough bug hunt after the first delivery. Regression tests first reproduced five failures; all failures were corrected. Additional failure paths were covered during review. Current verification: **51 automated tests passed; 15 browser workflow checks passed**.

| Finding | Resulting fix |
|---|---|
| Stored millisecond timestamps compared differently after normalization gained fractional precision | Re-normalize original payloads before comparison; old retries remain DUPLICATE |
| NUL/unpaired Unicode in IDs or extra metadata could make PostgreSQL abort an otherwise valid mixed batch | Reject unsafe text before business processing; preserve exact escaped JSON in TEXT with a safe JSONB projection |
| Oversized IDs/deep metadata could exceed index or nesting limits while logging rejected attempts | Bound useful indexed IDs and JSON nesting; use iterative serialization and depth-limited projections |
| Cached MQTT responses bypassed the currently configured candidate check | Check candidate identity before cache lookup |
| A foreign candidate could reserve a valid challenge ID | Audit routing failures without reserving IDs in the worker namespace |
| Response recovery/history included other candidate records | Filter outbox and monitoring by the configured candidate |
| Malformed JSON displayed an older challenge ID alongside a new failure | Reset identity/time for every incoming message and preserve null identity explicitly |
| Missing MQTT PUBACK could block shutdown/processing indefinitely | Bound subscription/publication waits, flush failed transport work and recover from PostgreSQL |
| Invalid broker configuration could leave a listening HTTP server behind | Validate broker URL before listening and clean up startup failures |
| Startup could attempt MQTT before the HTTP port successfully bound | Await listening before starting the worker |
| New unsent COUNT examples changed the correction target; source could differ from the original COUNT | Track only successful submitted counts and their source |
| A stalled submission left buttons disabled indefinitely | Add mutation deadlines, retain IDs and show an unknown-outcome safe-retry message |
| Invalid JSON left earlier successful submission results visible | Clear results at the beginning of each submission attempt |
| Simulator awaited PUBACK before observing response-timeout rejection | Observe publication/response promises together, clean listeners/timers and generate fresh default expiry after connecting |

Tests use generated disposable PostgreSQL databases and real local MQTT brokers; the main production database is not reset. Updated screenshots and JSON evidence reflect the revised browser checks. The external assessment broker has not been contacted; its separate approval remains pending.
