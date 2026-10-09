export const SUMMARY_FIELDS = ['net_total', 'processed_events', 'pending_ack', 'unresolved', 'duplicates', 'conflicts'];

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
      || hour > 23 || minute > 59 || second > 59) return null;
  if (match[7] !== 'Z') {
    const [offsetHour, offsetMinute] = match[7].slice(1).split(':').map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  // Preserve sub-millisecond precision in retry identity, even though JS Date
  // and dashboard display times are millisecond based.
  const fraction = (value.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0');
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, `.${fraction}Z`);
}
