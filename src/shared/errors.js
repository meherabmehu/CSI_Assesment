const reasons = {
  ECONNREFUSED: 'Connection refused. Check the database service, address and port.',
  ECONNRESET: 'The database connection was reset by the peer.',
  ENETUNREACH: 'The database network is unreachable.',
  ERR_SOCKET_BAD_PORT: 'PORT must be a valid HTTP port.',
  CONFIG_ERROR: 'Invalid database environment configuration.',
  ENOTFOUND: 'Hostname could not be resolved. Check the database host and private-network region.',
  EAI_AGAIN: 'DNS lookup failed temporarily.',
  ETIMEDOUT: 'Connection timed out. Check networking and database availability.',
  '28P01': 'Database authentication failed. Check the configured credentials in the hosting dashboard.',
  '28000': 'Database access denied. Check authentication and SSL requirements.',
  '3D000': 'Configured database does not exist.',
  '42501': 'Database permission denied. The application role must create and alter its schema objects.',
  '53300': 'Database connection limit reached.',
  '42P01': 'A required database table is missing.',
  '42703': 'A required database column is missing.',
  '23502': 'A migration encountered data that violates a NOT NULL constraint.',
  '42601': 'Migration SQL has a syntax error or is incompatible with the database version.',
  EADDRINUSE: 'HTTP port is already in use. Stop the existing app before starting another instance.',
  EACCES: 'HTTP binding or file access permission denied.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Database TLS certificate is self-signed. Check PGSSLMODE and the provider TLS requirements.',
  SELF_SIGNED_CERT_IN_CHAIN: 'Database TLS certificate chain is not trusted. Check the provider TLS requirements.',
  CERT_HAS_EXPIRED: 'Database TLS certificate has expired.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'Database TLS certificate does not match the host.',
};

// Never emit driver messages, details, stacks, URLs, hostnames or credential values.
export function safeError(error) {
  const code = Object.hasOwn(reasons, error?.code) ? error.code : 'UNKNOWN';
  if (code === 'UNKNOWN') {
    if (/server does not support SSL/i.test(error?.message || '')) return { code: 'SSL_UNSUPPORTED', reason: 'Database server does not support SSL. Check the selected endpoint and PGSSLMODE.' };
    if (/timeout|timed out/i.test(error?.message || '')) return { code: 'TIMEOUT', reason: 'Operation timed out. Check database availability and networking.' };
    if (/connection terminated/i.test(error?.message || '')) return { code: 'CONNECTION_CLOSED', reason: 'Database connection closed unexpectedly.' };
  }
  return { code, reason: reasons[code] || 'Operation failed. Check configuration and service availability for the reported stage.' };
}
