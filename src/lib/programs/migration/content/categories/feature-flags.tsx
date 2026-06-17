/**
 * Feature-flag migration content (Statsig variant).
 *
 * Guidance paraphrased from PostHog public docs:
 *   - posthog.com/docs/feature-flags/best-practices
 *   - posthog.com/docs/feature-flags/common-questions
 *   - posthog.com/docs/experiments/best-practices
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const FEATURE_FLAGS_BLOCKS: ContentBlock[] = [
  {
    content: 'A few things work a little differently in PostHog.',
    pause: 4500,
  },

  {
    content: (
      <Text>
        Flags evaluate against a stable user. Call{' '}
        <Text bold color={Colors.accent}>
          identify()
        </Text>{' '}
        first, then check the flag.
      </Text>
    ),
    pause: 6000,
    persist: true,
  },

  {
    content:
      'For anything in the first paint, evaluate server-side and bootstrap the values into the client.',
    pause: 6500,
  },

  {
    content: (
      <Text>
        In production, route requests through a reverse proxy to avoid ad
        blockers breaking your flags.{'\n'}
        <Text dimColor>https://posthog.com/docs/advanced/proxy</Text>
      </Text>
    ),
    pause: 6500,
    persist: true,
  },

  {
    content:
      'When a flag reaches 100% rollout, retire it. Flags are signals, not switches.',
    pause: 5500,
  },

  {
    content: (
      <Text>
        Name flags descriptively. No double negatives. Reflect the return type.{' '}
        <Text dimColor>For example </Text>
        <Text bold>show-new-checkout</Text>
        <Text dimColor>.</Text>
      </Text>
    ),
    pause: 6500,
    persist: true,
  },

  { type: 'clear', pause: 1500 },

  // ── Experiments ────────────────────────────────────────────────────────
  {
    content: (
      <Text bold color={Colors.accent}>
        Experiments
      </Text>
    ),
    pause: 2500,
    persist: true,
  },

  {
    content:
      'Change one thing per variant. Multiple changes in one variant blur the result.',
    pause: 5500,
  },

  {
    content:
      'Decide the running time up front. PostHog includes a sample-size and duration calculator in the setup flow.',
    pause: 6500,
  },

  {
    content: 'Roll out to 5–10% first. Watch the metrics. Then increase.',
    pause: 5000,
  },

  {
    content:
      'Exclude users who already completed the flow. They can’t be affected by the test.',
    pause: 5500,
  },

  { type: 'clear', pause: 1500 },

  // ── Close ──────────────────────────────────────────────────────────────
  {
    content: 'Flags and experiments live alongside the rest of your data.',
    pause: 4500,
  },

  {
    content: 'Ship behind a flag, watch replays, check analytics for impact.',
    pause: 4500,
  },
];
