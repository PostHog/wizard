/**
 * Sidebar tips after the feature-flags Learn deck finishes. Same story
 * as the deck, as footnotes, so the pane never overflows. Wired onto
 * the program's getTips; unset would fall back to generic onboarding
 * (persons, Stripe), which is the wrong lesson for this run.
 */

import type { Tip } from '@ui/tui/components/TipsCard';

export const FEATURE_FLAGS_TIPS: Tip[] = [
  {
    id: 'the-bill',
    title: 'This request inflates the bill',
    description:
      'Flags are billed per /flags call, not per person. Client init, identify, and reload each fetch. One server evaluateFlags plus bootstrap is the cheap path.',
  },
  {
    id: 'zero-percent',
    title: 'Until you raise it',
    description:
      'Skip is first: wiring only, no new flag. Confirm creates one boolean at 0%, so nothing happens yet. Raise rollout to 100% to see the UI, then set it back to kill it.',
  },
  {
    id: 'boolean-vs-multi',
    title: 'Boolean vs multivariate',
    description:
      'A boolean is on or off. That is today. Multivariate is green vs blue on the same key, when you have a real experiment.',
  },
  {
    id: 'bootstrap',
    title: 'Server, then the client',
    description:
      'evaluateFlags() once per request, then bootstrap those values into the client. First paint has no flicker and no second fetch. CI does not poll overnight.',
  },
  {
    id: 'not-audit',
    title: 'A kill switch, not an audit',
    description:
      'wizard feature-flags installs this path. wizard audit feature-flags is read-only, after flags already exist. The default wizard is product analytics.',
  },
];

export const getTips = (): Tip[] => FEATURE_FLAGS_TIPS;
