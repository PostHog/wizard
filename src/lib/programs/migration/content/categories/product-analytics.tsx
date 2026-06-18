/**
 * Product-analytics migration content (Mixpanel / Amplitude variants).
 *
 * The deck leads with PostHog's main differentiators rather than
 * tutorial-style guidance — the assumption is the user already knows
 * how product analytics works, they want to know why PostHog is
 * different. Source: posthog.com vs-comparison posts (e.g. the
 * "PostHog vs Amplitude" article).
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

export const PRODUCT_ANALYTICS_BLOCKS: ContentBlock[] = [
  {
    content: 'A few things to know about PostHog.',
    pause: 4000,
  },

  // ── All-in-one ─────────────────────────────────────────────────────────
  {
    content: 'PostHog covers more than product analytics.',
    pause: 4500,
  },

  {
    content: (
      <Text>
        Analytics, session replays,{' '}
        <Text bold color={Colors.accent}>
          feature flags
        </Text>
        , experiments,{' '}
        <Text bold color={Colors.accent}>
          error tracking
        </Text>
        , surveys.
      </Text>
    ),
    pause: 6000,
    persist: true,
  },

  {
    content: 'All in the same platform to build your product.',
    pause: 4500,
  },

  { type: 'clear', pause: 1500 },

  // ── Autocapture ────────────────────────────────────────────────────────
  {
    content: (
      <Text>
        <Text bold color={Colors.accent}>
          Autocapture
        </Text>{' '}
        is on by default.
      </Text>
    ),
    pause: 4500,
    persist: true,
  },

  {
    content:
      'Pageviews, clicks, and form submits get captured without manual tagging.',
    pause: 5500,
  },

  { type: 'clear', pause: 1500 },

  // ── SQL ────────────────────────────────────────────────────────────────
  {
    content: (
      <Text>
        <Text bold color={Colors.accent}>
          SQL
        </Text>{' '}
        is available against your event data.
      </Text>
    ),
    pause: 5000,
    persist: true,
  },

  {
    content: 'No paid add-on, no separate warehouse to provision.',
    pause: 4500,
  },

  { type: 'clear', pause: 1500 },

  // ── Everything is linked ───────────────────────────────────────────────
  {
    content: 'Events, replays, and errors all attach to the same person.',
    pause: 5000,
    persist: true,
  },

  {
    content:
      'From a funnel drop-off, click through to the users who dropped, then watch what they did.',
    pause: 6500,
  },

  { type: 'clear', pause: 1500 },

  // ── Closing note: tier + cap, kept brief on purpose ───────────────────
  {
    content: 'Each product has a free tier, and you can cap spend per product.',
    pause: 5000,
  },
];
