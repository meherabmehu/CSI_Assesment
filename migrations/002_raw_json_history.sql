ALTER TABLE submission_attempts ADD COLUMN IF NOT EXISTS raw_payload_text text;
UPDATE submission_attempts SET raw_payload_text = raw_payload::text WHERE raw_payload_text IS NULL;
ALTER TABLE submission_attempts ALTER COLUMN raw_payload_text SET NOT NULL;

ALTER TABLE mqtt_challenges ADD COLUMN IF NOT EXISTS request_body_text text;
UPDATE mqtt_challenges SET request_body_text = request_body::text WHERE request_body_text IS NULL;
ALTER TABLE mqtt_challenges ALTER COLUMN request_body_text SET NOT NULL;
