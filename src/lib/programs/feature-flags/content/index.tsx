import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';

const GATED_CODE: ContentBlock = {
  type: 'lines',
  interval: 400,
  pause: 7000,
  lines: [
    <Text dimColor>{'example — a flag around new code'}</Text>,
    <Text>
      <Text color="cyan">{'if'}</Text>
      <Text>{" (flags.isEnabled('new-checkout')) {"}</Text>
    </Text>,
    <Text>{'  showNewCheckout()'}</Text>,
    <Text>{'}'}</Text>,
  ],
};

const GRADUAL_ROLLOUT: ContentBlock = {
  type: 'lines',
  interval: 700,
  pause: 7000,
  lines: [
    <Text dimColor>{'example — new-checkout rollout'}</Text>,
    <Text>
      <Text color={Colors.accent}>{'▓'}</Text>
      <Text dimColor>{'░░░░░░░░░'}</Text>
      <Text>{'    5%  internal team'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'▓▓▓▓▓'}</Text>
      <Text dimColor>{'░░░░░'}</Text>
      <Text>{'   50%  half of users'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.success}>{'▓▓▓▓▓▓▓▓▓▓'}</Text>
      <Text>{'  100%  everyone'}</Text>
    </Text>,
  ],
};

const RUN_PLAN: ContentBlock = {
  type: 'lines',
  interval: 600,
  pause: 8000,
  lines: [
    <Text>
      <Text color="cyan">{'1 '}</Text>
      <Text>{'Create example flags, off at 0%'}</Text>
    </Text>,
    <Text>
      <Text color="cyan">{'2 '}</Text>
      <Text>{'Evaluate the backend flag on the server'}</Text>
    </Text>,
    <Text>
      <Text color="cyan">{'3 '}</Text>
      <Text>{'Evaluate the frontend flag in the UI'}</Text>
    </Text>,
    <Text>
      <Text color="cyan">{'4 '}</Text>
      <Text>{'Write a report on turning them on'}</Text>
    </Text>,
  ],
};

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => [
  {
    content: 'Welcome.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },
  { content: "I'm adding PostHog feature flags to your app.", pause: 5000 },

  { type: 'clear', pause: 1500 },

  {
    content:
      'A feature flag is a switch in your code that you flip from PostHog, with no deploy.',
    pause: 6000,
  },
  GATED_CODE,
  {
    content: 'Ship new code turned off, then turn it on when you are ready.',
    pause: 6000,
  },

  { type: 'clear', pause: 1500 },

  { content: 'Roll out gradually instead of all at once:', pause: 2500 },
  GRADUAL_ROLLOUT,
  {
    content:
      'Target who sees it: your team, a beta cohort, a plan, or a country.',
    pause: 6000,
  },
  {
    content:
      'Something breaks? Turn the flag off in seconds. No rollback, no redeploy.',
    pause: 7000,
  },

  { type: 'clear', pause: 1500 },

  {
    content:
      'Each evaluation is reported to PostHog, so you can see who got which value.',
    pause: 6500,
  },
  {
    content:
      'The same flags run experiments: split users between variants and measure the result.',
    pause: 7000,
  },

  { type: 'clear', pause: 1500 },

  { content: "Here's what I'm doing now:", pause: 2000 },
  RUN_PLAN,
  {
    content: 'Each side gets a flag only when your app has code there.',
    pause: 6000,
  },

  { type: 'clear', pause: 1500 },

  {
    pause: 5000,
    persist: true,
    content: <StatusPeekTrigger store={store} />,
  },
  {
    pause: 90000,
    content: (
      <Text>
        Press{' '}
        <Text color={Colors.accent} bold>
          S
        </Text>{' '}
        to follow along — or sit tight, I'll let you know when it's done.
      </Text>
    ),
  },
];
