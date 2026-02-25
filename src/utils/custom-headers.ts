/**
 * Builds a list of custom headers for ANTHROPIC_CUSTOM_HEADERS.
 * Each key is normalized to an X-* header name; encode() returns the string
 * expected by the env var (header lines separated by newlines).
 *
 * Use add() for arbitrary headers (e.g. X-WIZARD-META-*).
 * Use addFlag(flagKey, variant) for feature flags; they are sent as X-WIZARD-FLAG-*
 * and appear on PostHog events as $feature/<flagKey>.
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
      const headerName =
        'X-WIZARD-FLAG-' +
        flagKey
          .split('-')
          .map((s) => s.toUpperCase())
          .join('-');
      entries.push({ key: headerName, value: variant });
    },

    encode(): string {
      return entries.map(({ key, value }) => `${key}: ${value}`).join('\n');
    },
  };
}
