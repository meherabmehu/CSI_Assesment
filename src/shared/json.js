const MAX_DEPTH = 64;

export function supportedText(value) {
  return typeof value === 'string' && !value.includes('\u0000') && value.isWellFormed();
}

export function validIdentifier(value) {
  return supportedText(value) && value.trim().length > 0 && value.trim().length <= 128;
}

export function inspectJson(value) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (current.depth > MAX_DEPTH) return 'JSON nesting must not exceed 64 levels.';
    if (typeof current.value === 'string' && !supportedText(current.value)) {
      return 'JSON text must not contain NUL characters or unpaired Unicode surrogates.';
    }
    if (current.value !== null && typeof current.value === 'object') {
      for (const [key, child] of Object.entries(current.value)) {
        if (!supportedText(key)) return 'JSON keys must contain valid Unicode without NUL characters.';
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

// Iterative serialization keeps rejected deeply nested JSON loggable without
// overflowing the JS stack. Escaped NUL/surrogates are safe in PostgreSQL TEXT.
export function serializeJson(value, { sortKeys = false } = {}) {
  const tokens = [];
  const pending = [{ value }];
  while (pending.length) {
    const item = pending.pop();
    if (item.token !== undefined) { tokens.push(item.token); continue; }
    if (Array.isArray(item.value)) {
      tokens.push('[');
      pending.push({ token: ']' });
      for (let i = item.value.length - 1; i >= 0; i--) {
        pending.push({ value: item.value[i] });
        if (i > 0) pending.push({ token: ',' });
      }
    } else if (item.value !== null && typeof item.value === 'object') {
      tokens.push('{');
      const keys = Object.keys(item.value);
      if (sortKeys) keys.sort();
      pending.push({ token: '}' });
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        pending.push({ value: item.value[key] }, { token: ':' }, { token: JSON.stringify(key) });
        if (i > 0) pending.push({ token: ',' });
      }
    } else tokens.push(JSON.stringify(item.value) ?? 'null');
  }
  return tokens.join('');
}

// JSONB cannot represent some rejected inputs. Retain their exact serialized
// JSON in TEXT and a safe, depth-limited projection for filtering/display.
export function jsonProjection(value, depth = 0) {
  if (typeof value === 'string') return value.toWellFormed().replaceAll('\u0000', '\ufffd');
  if (value === null || typeof value !== 'object') return value ?? null;
  if (depth >= MAX_DEPTH) return '[JSON nesting limit exceeded]';
  if (Array.isArray(value)) return value.map((child) => jsonProjection(child, depth + 1));
  const projection = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    projection[key.toWellFormed().replaceAll('\u0000', '\ufffd')] = jsonProjection(child, depth + 1);
  }
  return projection;
}
