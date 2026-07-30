/**
 * Feature-flags learn deck. It explains when to use the program, then teaches
 * the release, fallback, evaluation, and verification model while the agent
 * runs the framework-specific Context Mill skill.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';
import {
  EVALUATION_PLACEMENT,
  RELEASE_SWITCH,
  ROLLOUT_METER,
  SAFE_PATHS,
  VERIFICATION_LOOP,
} from './visuals.js';

const CLEAR: ContentBlock = { type: 'clear', pause: 1500 };

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => [
  {
    content: 'Welcome.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },
  {
    content:
      "You have a change to ship, but you're not ready to release it to everyone.",
    pause: 5000,
  },
  { content: "That's when you reach for a feature flag.", pause: 4000 },
  {
    content: 'The Wizard handles the wiring. You keep the rollout.',
    pause: 5000,
  },

  CLEAR,

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

  {
    content: 'Deploying code and releasing it are different jobs.',
    pause: 5000,
  },
  {
    content:
      'Your deploy puts the code in production. The flag decides who meets it.',
    pause: 5500,
  },
  RELEASE_SWITCH,

  CLEAR,

  {
    content: 'New flags start at 0%. Nobody gets surprised.',
    pause: 4000,
  },
  {
    content:
      'Release to a small group, watch the result, then widen the rollout.',
    pause: 5500,
  },
  ROLLOUT_METER,
  {
    content:
      'If the release misbehaves, return the rollout to 0% instead of redeploying.',
    pause: 5500,
  },

  CLEAR,

  { content: 'A safe fallback should be gloriously boring.', pause: 4500 },
  {
    content:
      'False, loading, or unavailable all lead back to the existing experience.',
    pause: 5500,
  },
  SAFE_PATHS,
  {
    content:
      'Flags choose an experience. Authentication and permissions stay in code.',
    pause: 6000,
  },

  CLEAR,

  {
    content: 'Evaluate the flag where the experience begins.',
    pause: 4000,
  },
  {
    content:
      'For the first paint, evaluate on the server and bootstrap the value to avoid flicker.',
    pause: 6000,
  },
  {
    content:
      'For an interaction after load, client-side evaluation is a good fit.',
    pause: 5000,
  },
  EVALUATION_PLACEMENT,

  CLEAR,

  {
    content: 'Test both doors before inviting users in.',
    pause: 4500,
  },
  VERIFICATION_LOOP,
  {
    content:
      'Done means both experiences work and PostHog received a live evaluation.',
    pause: 6000,
  },
  { content: 'Ship the code. Keep the release button.', pause: 8000 },
];
