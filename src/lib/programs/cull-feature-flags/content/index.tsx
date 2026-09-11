import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';

const CULL_LANES: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
  lines: [
    <Text>
      <Text color={Colors.accent}>Decided in PostHog</Text>
      <Text dimColor>{'\nPostHog is at 100% or 0%'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>Off in PostHog, still in code</Text>
      <Text dimColor>{'\nPostHog says off, code still asks'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>In PostHog, not in code</Text>
      <Text dimColor>{'\nPostHog has it, nobody asks'}</Text>
    </Text>,
  ],
};

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => [
  {
    content: store?.session.apiUser?.first_name
      ? `Welcome, ${store.session.apiUser.first_name}.`
      : 'Welcome.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },
  {
    content: "I'm looking for feature flags this project no longer needs.",
    pause: 5000,
  },

  { type: 'clear', pause: 1500 },

  { content: 'A flag lives in two places.', pause: 3000 },
  { content: 'PostHog decides. Your code asks.', pause: 3500 },
  { content: 'Stale is when the two drift apart.', pause: 4000 },
  CULL_LANES,
  { content: 'Everything else is “Nothing to cull”.', pause: 3000 },

  { type: 'clear', pause: 1500 },

  {
    content: 'The wizard found every call site before I started.',
    pause: 4000,
  },
  {
    content: 'A call site is the line of code that asks PostHog about a flag.',
    pause: 5500,
  },
  {
    content: 'I read each one and confirm the flag is done, or keep it.',
    pause: 5000,
  },
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

  { type: 'clear', pause: 1500 },

  { content: 'Nothing changes until you pick.', pause: 3000 },
  {
    content:
      'Culling keeps the code that runs today, drops the check, and disables the flag in PostHog.',
    pause: 5000,
  },
  { content: 'Never deleted.', pause: 1500 },
  {
    content:
      'Undo is one step each: git checkout for the code, one toggle on the flag page for PostHog.',
    pause: 6500,
  },

  { type: 'clear', pause: 1500 },

  {
    content: 'Verifying now. The list on the right moves as I go.',
    pause: 20000,
    persist: true,
  },
];
