export function redactSecrets(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    let redacted = value.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/([?&](?:token|key|secret|password|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
    for (const [name, secret] of Object.entries(process.env)) {
      if (/(?:token|password|secret|api_key|dsn|postgres_url|database_url)/i.test(name) && secret?.length >= 6) redacted = redacted.split(secret).join('[REDACTED]');
    }
    return redacted;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(entry => redactSecrets(entry, seen));
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    out[key] = typeof key === 'string' && /^(?:authorization|cookie|set-cookie|.*token|.*password|.*secret|.*api[_-]?key)$/i.test(key) ? '[REDACTED]' : redactSecrets(value[key], seen);
  }
  if (value instanceof Error) { out.message = redactSecrets(value.message, seen); out.stack = redactSecrets(value.stack, seen); }
  return out;
}
