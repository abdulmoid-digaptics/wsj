/**
 * Log hygiene. Anything written to logs passes through here first so that card numbers,
 * secrets and tokens never reach log files or monitoring, even inside an error message.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:\d[ -]?){13,19}\b/g, '[card-number]'],
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, '[stripe-key]'],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, '[webhook-secret]'],
  [/\b(pi|seti|cs|pm|cus|sub|in|ch|re)_[A-Za-z0-9]{20,}_secret_[A-Za-z0-9]+/g, '[client-secret]'],
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [token]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  [/([?&#](?:token|code|secret|password|key)=)[^&\s#]+/gi, '$1[redacted]'],
  [/("?(?:password|passwordHash|token|secret|cvc|cvv|card_number|authorization)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi, '$1[redacted]'],
  [/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[redacted]@'],
  [/(smtps?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[redacted]@'],
];

export function redact(value: unknown, max = 2000): string {
  let text = typeof value === 'string' ? value : value instanceof Error ? value.name + ': ' + value.message : safeJson(value);
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function safeJson(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

/** One structured, redacted log line. */
export function logEvent(level: 'error' | 'warn' | 'info', event: string, fields: Record<string, unknown> = {}) {
  const line: Record<string, unknown> = {level, event, at: new Date().toISOString()};
  for (const [k, v] of Object.entries(fields)) line[k] = typeof v === 'number' || typeof v === 'boolean' || v === null ? v : redact(v, 1000);
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out); else if (level === 'warn') console.warn(out); else console.log(out);
}
