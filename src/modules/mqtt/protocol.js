import { createHash } from 'node:crypto';
import { canonicalJson, isObject, parseTimestamp } from '../../shared/contracts.js';

export function challengeDigest(body) {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

export function validateChallenge(body, candidateId, now = Date.now()) {
  if (!isObject(body)) return { code: 'VALIDATION_ERROR', message: 'The challenge must be a JSON object.' };
  if (body.protocol_version !== '1.0') return { code: 'UNSUPPORTED_PROTOCOL', message: 'Only protocol version 1.0 is supported.' };
  if (body.candidate_id !== candidateId) return { code: 'CANDIDATE_MISMATCH', message: 'The challenge candidate ID does not match this worker.' };
  if (typeof body.challenge_id !== 'string' || !body.challenge_id.trim() || body.challenge_id.length > 128) {
    return { code: 'VALIDATION_ERROR', message: 'A non-empty challenge_id is required.' };
  }
  if (body.command !== 'PROCESS_EVENTS') return { code: 'VALIDATION_ERROR', message: 'command must be PROCESS_EVENTS.' };
  const sentAt = parseTimestamp(body.sent_at);
  const expiresAt = parseTimestamp(body.expires_at);
  if (!sentAt || !expiresAt || Date.parse(expiresAt) <= Date.parse(sentAt)) {
    return { code: 'VALIDATION_ERROR', message: 'Valid sent_at and expires_at timestamps are required; expiry must follow sent_at.' };
  }
  if (Date.parse(expiresAt) <= now) return { code: 'CHALLENGE_EXPIRED', message: 'The challenge has expired.' };
  if (!Array.isArray(body.events) || body.events.length > 500) {
    return { code: 'VALIDATION_ERROR', message: 'events must be an array of up to 500 events.' };
  }
  return null;
}

export function failureResponse(body, candidateId, code, message) {
  return {
    protocol_version: '1.0', candidate_id: candidateId,
    challenge_id: typeof body?.challenge_id === 'string' ? body.challenge_id : null,
    status: 'FAILED', error_code: code, message, processed_at: new Date().toISOString(),
  };
}
