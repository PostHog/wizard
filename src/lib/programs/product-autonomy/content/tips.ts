/**
 * Sidebar tips for the product-autonomy run. Unlike the generic
 * onboarding tips (`DEFAULT_TIPS`), these explain Signals' core nouns —
 * signal sources and scouts — in plain language, so the agent's
 * questions during the run land with a user who's never seen the terms.
 *
 * Product knowledge lives here in the program, not in the generic
 * `TipsCard`. Wired onto the program's `getTips`.
 */

import type { Tip } from '@ui/tui/components/TipsCard';

export const PRODUCT_AUTONOMY_TIPS: Tip[] = [
  {
    id: 'what-is-a-signal-source',
    title: "What's a signal source?",
    description:
      'A signal source is a PostHog product or connected tool — errors, session replays, support, GitHub or Linear issues — that feeds findings into your Self-driving inbox.',
  },
  {
    id: 'what-is-a-scout',
    title: "What's a scout?",
    description:
      'Scouts are scheduled checks that scan your data and flag issues — a spike in errors, a dropping funnel — straight to your inbox.',
  },
  {
    id: 'findings-in-inbox',
    title: 'Findings land in your inbox',
    description:
      'Once setup finishes, PostHog starts scanning within ~30 minutes and surfaces what it finds in your Self-driving inbox — grouped, researched, and ready to act on.',
  },
];

export const getTips = (): Tip[] => PRODUCT_AUTONOMY_TIPS;
