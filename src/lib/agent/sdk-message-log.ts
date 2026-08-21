/**
 * Format SDK stream messages for the wizard log file without unbounded growth.
 *
 * Lives next to agent code (not in `debug.ts`) so SDK message shape knowledge
 * stays out of infra — same boundary as handoff text caps.
 */

/** Per-string field truncation before compact JSON.stringify. */
export const MAX_LOG_FIELD_CHARS = 2 * 1024;

function truncateField(value: string): string {
  if (value.length <= MAX_LOG_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_LOG_FIELD_CHARS)}… [truncated, ${
    value.length
  } chars]`;
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return truncateField(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitize(child, seen);
  }
  return out;
}

/**
 * Deep-clone `value` and truncate every string leaf longer than
 * {@link MAX_LOG_FIELD_CHARS}. Never mutates the input.
 */
export function sanitizeSdkMessageForLog(value: unknown): unknown {
  return sanitize(value, new WeakSet());
}

/**
 * Compact JSON for `logToFile`. Drops pretty-printing and truncates large
 * string fields so a 100 KB tool_result cannot allocate a multi-MB log line.
 */
export function formatSdkMessageForLog(message: unknown): string {
  try {
    return (
      JSON.stringify(sanitizeSdkMessageForLog(message)) ?? '[unserializable]'
    );
  } catch {
    return '[unserializable]';
  }
}
