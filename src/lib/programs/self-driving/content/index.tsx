/**
 * Self-driving learn-deck — the narrative script played while the agent
 * sets up Self-driving. Teaches the vocabulary ladder (signal source →
 * scout → signal → report → action → measured loop) before the agent's
 * questions use those nouns, and explains why GitHub is required before
 * the connect ask lands.
 *
 * One deck for every self-driving run. On the integrate path it plays
 * during the install run (the pane belongs to whichever run screen shows
 * first), so it doubles as the wait-time read.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';
import { PIPELINE_BLOCK } from './pipeline-diagram.js';

const CLEAR: ContentBlock = { type: 'clear', pause: 2000 };

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => {
  return [
    // Scene 1 — orient
    {
      content: 'Welcome.',
      pause: 3000,
      mode: TextRevealMode.Typewriter,
      animationInterval: 160,
    },

    { content: 'The Wizard is an agent.', pause: 4000 },

    {
      content: "It's setting up PostHog Self-driving for this project.",
      pause: 5000,
    },

    {
      content:
        'We'll occasionally need your input. Stick around.',
      pause: 6000,
    },

    CLEAR,

    // Scene 2 — controls
    {
      pause: 5000,
      persist: true,
      content: <StatusPeekTrigger store={store} />,
    },

    {
      pause: 6000,
      content: (
        <Text>
          Press{' '}
          <Text color={Colors.accent} bold>
            S
          </Text>{' '}
          to expand or collapse the status.
        </Text>
      ),
    },

    CLEAR,

    // Scene 3 — platform story
    {
      content: 'Your PostHog tools all share one data layer.',
      pause: 4000,
    },

    {
      content:
        'Analytics, replays, errors, flags: they all share the same users, mapped across every tool.',
      pause: 6000,
    },

    {
      content: 'Together, they show how people really use your product.',
      pause: 5000,
    },

    {
      content:
        "Piecing that together used to be manual work. That's what Self-driving automates.",
      pause: 6000,
    },

    CLEAR,

    // Scene 4 — the differentiator, and why GitHub
    {
      content:
        'A coding agent has your code, but not your product usage context.',
      pause: 5000,
    },

    { content: 'PostHog knows what your users actually do.', pause: 4000 },

    { content: 'Self-driving puts an agent in the loop.', pause: 5000 },

    {
      content:
        "That's why setup will ask to connect GitHub: so Self-driving can access your code and your context, together.",
      pause: 6000,
    },

    CLEAR,

    // Scene 5 — signal sources
    {
      content: 'Each PostHog tool you enable is a signal source.',
      pause: 4000,
    },

    {
      content:
        "Errors, replays, support tickets, GitHub or Linear issues: they're all streams of product usage.",
      pause: 6000,
    },

    CLEAR,

    // Scene 6 — scouts
    {
      content: 'Scouts are agents that watch those sources on a schedule.',
      pause: 5000,
    },

    {
      content:
        'They look for anomalies and patterns: a spike in errors or a funnel quietly dropping.',
      pause: 6000,
    },

    { content: 'Setup tunes your scouts to fit your product.', pause: 4000 },

    CLEAR,

    // Scene 7 — signals and reports
    {
      content:
        "When a scout finds something worth your attention, that's a signal.",
      pause: 5000,
    },

    {
      content:
        'Each signal carries the finding, the evidence, and a suggested action.',
      pause: 5000,
    },

    {
      content: 'Related signals group into reports, sorted by priority.',
      pause: 4000,
    },

    CLEAR,

    { content: "Here's the whole loop.", pause: 1000 },

    PIPELINE_BLOCK,

    CLEAR,

    // Scene 8 — payoff: the inbox
    { content: 'Reports land in your Self-driving inbox.', pause: 4000 },

    {
      content: 'Investigate with the agent, tag teammates, or kick off a PR.',
      pause: 6000,
    },

    CLEAR,

    // Scene 9 — the loop kicker
    {
      content: 'And after the PR ships, PostHog measures the result.',
      pause: 5000,
    },

    { content: 'Did the fix actually address the pattern?', pause: 4000 },

    {
      content: 'If not, a new signal surfaces, and the loop keeps working.',
      pause: 6000,
    },

    CLEAR,

    // Scene 10 — surfaces + closer
    {
      content: 'Work with Self-driving wherever you already are:',
      pause: 2000,
    },

    {
      type: 'lines',
      interval: 800,
      pause: 6000,
      lines: [
        <Text>
          <Text color="cyan">{'  ◆ '}</Text>
          <Text bold>Inbox</Text>
          <Text dimColor>{'   the PostHog web app'}</Text>
        </Text>,
        <Text>
          <Text color="cyan">{'  ◆ '}</Text>
          <Text bold>Slack</Text>
          <Text dimColor>{'   tag @PostHog'}</Text>
        </Text>,
        <Text>
          <Text color="cyan">{'  ◆ '}</Text>
          <Text bold>MCP</Text>
          <Text dimColor>{'     your agents and editors'}</Text>
        </Text>,
      ],
    },

    {
      content: 'Product usage data becomes real, shippable change.',
      pause: 5000,
    },

    { content: 'Your product drives itself.', pause: 10000 },
  ];
};
