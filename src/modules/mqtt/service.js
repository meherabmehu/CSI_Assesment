import { withTransaction } from '../../shared/db.js';
import { notifyChanges } from '../../shared/domain-events.js';
import { isObject } from '../../shared/contracts.js';
import { validIdentifier, jsonProjection, serializeJson } from '../../shared/json.js';
import { processEventsInTransaction } from '../events/service.js';
import { getSummary } from '../state/queries.js';
import { recordAudit } from '../audit/service.js';
import { challengeDigest, validateChallenge, failureResponse } from './protocol.js';

export async function handleChallenge(pool, body, candidateId) {
  if (!isObject(body)) return failureResponse(body, candidateId, 'VALIDATION_ERROR', 'The challenge must be a JSON object.');
  const notifications = [];
  const response = await withTransaction(pool, async (client) => {
    const validId = validIdentifier(body.challenge_id);
    // A foreign candidate must neither access cached results nor reserve an ID
    // in this worker's challenge namespace.
    if (body.candidate_id !== candidateId) {
      await recordAudit(client, null, 'MQTT_CANDIDATE_REJECTED', { challenge_id: validId ? body.challenge_id : null });
      return failureResponse(body, candidateId, 'CANDIDATE_MISMATCH', 'The challenge candidate ID does not match this worker.');
    }
    const digest = challengeDigest(body);
    if (validId) {
      const existing = await client.query('SELECT request_digest, response_body FROM mqtt_challenges WHERE challenge_id = $1', [body.challenge_id]);
      if (existing.rowCount) {
        if (existing.rows[0].request_digest === digest) return existing.rows[0].response_body;
        await recordAudit(client, null, 'MQTT_CHALLENGE_CONFLICT', { challenge_id: body.challenge_id });
        return failureResponse(body, candidateId, 'CHALLENGE_CONFLICT', 'The challenge ID was already used for a different request.');
      }
    }

    const error = validateChallenge(body, candidateId);
    let response;
    if (error) {
      response = failureResponse(body, candidateId, error.code, error.message);
    } else {
      const results = await processEventsInTransaction(client, body.events, { transport: 'MQTT', challengeId: body.challenge_id }, notifications);
      response = {
        protocol_version: '1.0', candidate_id: candidateId, challenge_id: body.challenge_id,
        status: 'COMPLETED', processed_at: new Date().toISOString(), results,
        state: await getSummary(client),
      };
    }
    if (validId) {
      await client.query(`INSERT INTO mqtt_challenges(challenge_id, request_digest, request_body, response_body, status, request_body_text)
        VALUES ($1,$2,$3,$4,$5,$6)`, [body.challenge_id, digest, JSON.stringify(jsonProjection(body)), response, response.status, serializeJson(body)]);
      await recordAudit(client, null, 'MQTT_CHALLENGE_PROCESSED', { challenge_id: body.challenge_id, status: response.status });
    }
    return response;
  });
  notifyChanges(notifications);
  return response;
}
