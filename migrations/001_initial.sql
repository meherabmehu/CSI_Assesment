CREATE TABLE IF NOT EXISTS production_sources (
    source_id text PRIMARY KEY,
    display_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_events (
    ingestion_order bigserial UNIQUE,
    event_id text PRIMARY KEY,
    source_id text NOT NULL REFERENCES production_sources(source_id),
    type text NOT NULL CHECK (type IN ('COUNT', 'VOID')),
    quantity integer,
    target_event_id text,
    event_time timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    status text NOT NULL CHECK (status IN ('ACCEPTED', 'PENDING_REFERENCE', 'REJECTED')),
    reason text,
    normalized_payload jsonb NOT NULL,
    acknowledged_at timestamptz,
    acknowledgement_method text CHECK (acknowledgement_method IN ('MANUAL', 'AUTOMATIC')),
    CHECK ((type = 'COUNT' AND quantity > 0 AND target_event_id IS NULL)
        OR (type = 'VOID' AND quantity IS NULL AND target_event_id IS NOT NULL)),
    CHECK (type <> 'VOID' OR event_id <> target_event_id)
);

ALTER TABLE production_events ADD COLUMN IF NOT EXISTS ingestion_order bigserial;

-- A pending VOID deliberately has no target foreign key: its COUNT may arrive later.
CREATE UNIQUE INDEX IF NOT EXISTS one_completed_void_per_count
    ON production_events(target_event_id) WHERE type = 'VOID' AND status = 'ACCEPTED';
CREATE INDEX IF NOT EXISTS events_by_source ON production_events(source_id, received_at);
CREATE INDEX IF NOT EXISTS pending_void_targets ON production_events(target_event_id, received_at)
    WHERE status = 'PENDING_REFERENCE';

CREATE TABLE IF NOT EXISTS submission_attempts (
    id bigserial PRIMARY KEY,
    raw_payload jsonb NOT NULL,
    source_id text,
    event_id text,
    classification text NOT NULL CHECK (classification IN ('ACCEPTED', 'PENDING_REFERENCE', 'DUPLICATE', 'CONFLICT', 'REJECTED')),
    error text,
    transport text NOT NULL CHECK (transport IN ('REST', 'MQTT')),
    challenge_id text,
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_by_source ON submission_attempts(source_id, classification);

CREATE TABLE IF NOT EXISTS mqtt_challenges (
    challenge_id text PRIMARY KEY,
    request_digest text NOT NULL,
    request_body jsonb NOT NULL,
    response_body jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz NOT NULL DEFAULT now(),
    last_published_at timestamptz,
    delivery_attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
    id bigserial PRIMARY KEY,
    event_id text,
    action text NOT NULL,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
