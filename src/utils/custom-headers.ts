import {
  POSTHOG_FLAG_HEADER_PREFIX,
  POSTHOG_PROPERTY_HEADER_PREFIX,
} from '@lib/constants';

/**
 * Wizard run metadata as the single JSON blob the slugless (Go) gateway reads.
 *
 * Two gateway generations parse run metadata differently. The Python gateway
 * reads `X-POSTHOG-PROPERTY-<key>` headers one at a time; the Go one ignores
 * those completely and merges only this blob onto `$ai_generation`. Which
 * gateway serves a run is a server-side routing decision the CLI cannot see,
 * so callers send both shapes and let each gateway read the one it understands.
 * Sending the blob alone would lose attribution on Python-gateway runs.
 *
 * Keys arrive bare (`program_id`) but a caller may pre-prefix them, so the
 * prefix is stripped for the blob — the Go gateway wants the property name, not
 * the header name. `JSON.stringify` escapes any newline in a value, which the
 * newline-delimited ANTHROPIC_CUSTOM_HEADERS block depends on.
 *
 * @returns the header value, or undefined when there is no metadata to send.
 */
export function posthogPropertiesBlob(
  wizardMetadata: Record<string, string>,
): string | undefined {
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(wizardMetadata)) {
    if (value === undefined || value === '') continue;
    const name = key.toUpperCase().startsWith(POSTHOG_PROPERTY_HEADER_PREFIX)
      ? key.slice(POSTHOG_PROPERTY_HEADER_PREFIX.length)
      : key;
    properties[name] = value;
  }
  return Object.keys(properties).length > 0
    ? JSON.stringify(properties)
    : undefined;
}

/**
 * Builds a list of custom headers for ANTHROPIC_CUSTOM_HEADERS.
 */
export function createCustomHeaders(): {
  add(key: string, value: string): void;
  /** Add a feature flag for PostHog ($feature/<flagKey>: variant). */
  addFlag(flagKey: string, variant: string): void;
  encode(): string;
} {
  const entries: Array<{ key: string; value: string }> = [];

  return {
    add(key: string, value: string): void {
      const name =
        key.startsWith('x-') || key.startsWith('X-') ? key : `X-${key}`;
      entries.push({ key: name, value });
    },

    addFlag(flagKey: string, variant: string): void {
      const headerName = POSTHOG_FLAG_HEADER_PREFIX + flagKey.toUpperCase();
      entries.push({ key: headerName, value: variant });
    },

    encode(): string {
      return entries.map(({ key, value }) => `${key}: ${value}`).join('\n');
    },
  };
}
