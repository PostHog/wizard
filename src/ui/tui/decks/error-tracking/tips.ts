/** Sidebar tips for the error-tracking run: product features the learn deck does not cover. */

import type { Tip } from '@ui/tui/components/TipsCard';
import { REPLAY_VISION_SUPPORTED } from '@programs/replay-vision/index';

export const ERROR_TRACKING_TIPS: Tip[] = [
  {
    id: 'session-replay',
    title: 'Watch the crash happen',
    description:
      'An exception from a recorded session links to its replay. See the clicks that led to the error, not only the stack trace.',
    // Replay records only on platforms with a client SDK.
    visible: (store) => {
      const integration = store.session.integration;
      return integration != null && REPLAY_VISION_SUPPORTED.has(integration);
    },
  },
  {
    id: 'alerts',
    title: 'Know when a bug comes back from the dead',
    description:
      'Set alerts for new issues, issues that return after you resolve them, and sudden spikes. Hear about them before your users do.',
  },
  {
    id: 'external-issues',
    title: 'From crash to ticket in one click',
    description:
      'Create a GitHub, GitLab, Jira or Linear issue straight from an error.',
  },
];

export const getTips = (): Tip[] => ERROR_TRACKING_TIPS;
