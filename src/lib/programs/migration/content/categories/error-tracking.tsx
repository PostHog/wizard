/**
 * Error-tracking migration content (Sentry variant).
 *
 * Guidance paraphrased from PostHog public docs:
 *   - posthog.com/docs/error-tracking/installation
 *   - posthog.com/docs/error-tracking/source-maps
 *   - posthog.com/docs/error-tracking/alerts
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const ERROR_TRACKING_BLOCKS: ContentBlock[] = [
  {
    content: 'A few things work a little differently in PostHog.',
    pause: 4500,
  },

  {
    content: (
      <Text>
        Unhandled exceptions are autocaptured by the SDK. Use{' '}
        <Text bold color={Colors.accent}>
          captureException()
        </Text>{' '}
        for ones you catch yourself.
      </Text>
    ),
    pause: 6500,
    persist: true,
  },

  {
    content:
      'Errors are linked to the same person who fired the events and session replays. One identity, one story.',
    pause: 6500,
  },

  {
    content: (
      <Text>
        Upload source maps on every release so production stack traces resolve
        to real lines.{'\n'}
        <Text dimColor>npx @posthog/wizard upload-sourcemaps</Text>
      </Text>
    ),
    pause: 7000,
    persist: true,
  },

  {
    content:
      'Set release / environment / user context once at SDK init. Every error inherits them.',
    pause: 6500,
  },

  {
    content: (
      <Text>
        From a captured error, jump straight into the session replay around it.{' '}
        <Text dimColor>You see the click that broke it.</Text>
      </Text>
    ),
    pause: 6500,
    persist: true,
  },

  {
    content:
      'Filter PII before send. The before_send hook runs on every captured event.',
    pause: 5500,
  },

  { type: 'clear', pause: 1500 },

  // ── Close ──────────────────────────────────────────────────────────────
  {
    content: 'Errors live alongside the rest of your data.',
    pause: 4000,
  },

  {
    content:
      'See the user, the events leading up, the exception, and the replay — without leaving the page.',
    pause: 6000,
  },
];
