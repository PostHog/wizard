import { POSTHOG_FLAG_HEADER_PREFIX } from '../lib/constants';

/**
 * Builds a list of custom headers for wizard provider requests.
 */
export function createCustomHeaders(): {
  add(key: string, value: string): void;
  /** Add a feature flag for PostHog ($feature/<flagKey>: variant). */
  addFlag(flagKey: string, variant: string): void;
  encode(): string;
  toObject(): Record<string, string>;
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

    toObject(): Record<string, string> {
      return Object.fromEntries(entries.map(({ key, value }) => [key, value]));
    },
  };
}
