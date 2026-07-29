/**
 * Feature-flags learn deck. It explains the safety model while the agent picks
 * and runs the framework-specific Context Mill skill.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

const FLAG_PATHS: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 6000,
  lines: [
    <Text>
      <Text color={Colors.muted}>flag false</Text>
      <Text dimColor>{'       -> control experience'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>flag true</Text>
      <Text dimColor>{'        -> flagged experience'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.muted}>flag unavailable</Text>
      <Text dimColor>{' -> control experience'}</Text>
    </Text>,
  ],
};

const VERIFICATION: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 7000,
  lines: [
    <Text>
      <Text color={Colors.accent}>{'  1  '}</Text>
      <Text>Run the control path</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  2  '}</Text>
      <Text>Run the flagged path</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  3  '}</Text>
      <Text>Confirm the live evaluation</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  4  '}</Text>
      <Text>Restore the safe rollout</Text>
    </Text>,
  ],
};

export const getContentBlocks = (): ContentBlock[] => [
  {
    content: 'Welcome.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },
  {
    content:
      "I'm choosing the feature flag skill that best matches this application.",
    pause: 5000,
  },

  { type: 'clear', pause: 1500 },

  {
    content: 'Feature flags separate deployment from release.',
    pause: 4500,
  },
  {
    content:
      'The code can ship while the existing experience remains the default.',
    pause: 5000,
  },
  FLAG_PATHS,

  { type: 'clear', pause: 1500 },

  {
    content: 'A safe flag has a boring fallback.',
    pause: 4000,
  },
  {
    content:
      'False, unavailable, and still loading should all preserve the control experience.',
    pause: 6000,
  },
  {
    content:
      'A feature flag can control product behavior, but it must never be the security boundary.',
    pause: 6500,
  },

  { type: 'clear', pause: 1500 },

  {
    content: 'Where the flag is evaluated matters.',
    pause: 4000,
  },
  {
    content:
      'Use server-side evaluation for the first paint, then bootstrap the value into the client to avoid flicker.',
    pause: 6500,
  },
  {
    content:
      'Client-side evaluation fits interactions that happen after the page has loaded.',
    pause: 5500,
  },

  { type: 'clear', pause: 1500 },

  {
    content: 'Verification means exercising both experiences.',
    pause: 4500,
  },
  VERIFICATION,
  {
    content:
      'Done means the code works and PostHog received a real flag evaluation.',
    pause: 6000,
  },
];
