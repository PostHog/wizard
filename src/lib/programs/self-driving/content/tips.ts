/**
 * Sidebar tips for the self-driving run. Unlike the generic
 * onboarding tips (`DEFAULT_TIPS`), these explain Signals' core nouns —
 * signal sources and scouts — in plain language, so the agent's
 * questions during the run land with a user who's never seen the terms.
 *
 * Product knowledge lives here in the program, not in the generic
 * `TipsCard`. Wired onto the program's `getTips`.
 */

import type { Tip } from '@ui/tui/components/TipsCard';

export const SELF_DRIVING_TIPS: Tip[] = [
  {
    id: 'what-is-a-signal-source',
    title: "What's a signal source?",
    description:
      'A signal source is one of the streams PostHog plugs straight into — your errors, session replays, support, GitHub or Linear issues. Each one watches its own stream and speaks up the moment something specific goes wrong there.',
  },
  {
    id: 'what-is-a-scout',
    title: "What's a scout?",
    description:
      'A scout is like an analyst PostHog runs for you on a schedule: rather than watching one stream, it ranges freely across your product data, looking for the bigger trends and surprises — a spike in errors, a funnel quietly dropping — that no single stream would catch.',
  },
  {
    id: 'findings-in-inbox',
    title: 'Findings land in your inbox',
    description:
      'Once setup finishes, PostHog starts scanning within ~30 minutes and surfaces what it finds in your Self-driving inbox — grouped, researched, and ready to act on.',
  },
];

export const getTips = (): Tip[] => SELF_DRIVING_TIPS;
