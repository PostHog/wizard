/**
 * Sidebar tips for the self-driving run — short footnotes on the
 * vocabulary ladder (signal source → scout → signal → report → measured
 * loop). The learn deck (`./index.tsx`) carries the teaching; these stay
 * one to two lines each so the pane never overflows.
 *
 * Product knowledge lives here in the program, not in the generic
 * `TipsCard`. Wired onto the program's `getTips`.
 */

import type { Tip } from '@ui/tui/components/TipsCard';

export const SELF_DRIVING_TIPS: Tip[] = [
  {
    id: 'signal-source',
    title: 'Signal source',
    description:
      'A stream PostHog watches: errors, replays, support, GitHub or Linear issues.',
  },
  {
    id: 'scout',
    title: 'Scout',
    description:
      'An agent on a schedule, watching your sources for anomalies and patterns.',
  },
  {
    id: 'signal-report',
    title: 'Signal → report',
    description:
      'One finding with evidence and a suggested action. Signals group into prioritized reports in your inbox.',
  },
  {
    id: 'the-loop',
    title: 'The loop',
    description:
      'After a fix ships, PostHog measures the result. If the pattern persists, a new signal reopens the work.',
  },
  {
    id: 'pricing',
    title: 'What it costs',
    description:
      'Watching is free. You pay a flat $15 only when a report ships a PR.',
  },
  {
    id: 'work-anywhere',
    title: 'Work anywhere',
    description:
      'Your inbox is in the PostHog app, Slack (tag @PostHog), and MCP. You can work from anywhere.',
  },
];

export const getTips = (): Tip[] => SELF_DRIVING_TIPS;
