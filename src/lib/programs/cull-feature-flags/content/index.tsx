import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

const STALE_WAYS: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 7000,
  lines: [
    <Text>
      <Text color={Colors.accent}>{'100%'}</Text>
      <Text dimColor>{'  on for everyone, check is dead weight'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  0%'}</Text>
      <Text dimColor>{'  off for everyone, feature never ships'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{' off'}</Text>
      <Text dimColor>{'  disabled or archived, code still asks'}</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'   ?'}</Text>
      <Text dimColor>{'  in PostHog, never evaluated in code'}</Text>
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
    content: "I'm looking for feature flags this project no longer needs.",
    pause: 5000,
  },

  { type: 'clear', pause: 1500 },

  {
    content:
      'A flag is a switch. Once everyone has the feature, the switch is a dead branch in your code.',
    pause: 6000,
  },
  { content: 'Four ways a flag goes stale:', pause: 2000 },
  STALE_WAYS,

  { type: 'clear', pause: 1500 },

  {
    content:
      "I don't guess. The wizard scanned every source file and pulled your flags from PostHog before I started.",
    pause: 6500,
  },
  {
    content:
      'Fixed rules put each flag in a bucket. My job is to read the call site and confirm it, or keep the flag.',
    pause: 6500,
  },

  { type: 'clear', pause: 1500 },

  {
    content:
      'Nothing changes until you pick. One prompt: report only, or cull the flags you choose.',
    pause: 6000,
  },
  {
    content:
      'Culling keeps the winning branch, drops the check, and disables the flag in PostHog. Never deleted.',
    pause: 6500,
  },
  {
    content:
      'Undo is one step each: git checkout for the code, one toggle on the flag page for PostHog.',
    pause: 6500,
  },

  { type: 'clear', pause: 1500 },

  {
    content: 'Verifying call sites now. The list on the right moves as I go.',
    pause: 60000,
    persist: true,
  },
];
