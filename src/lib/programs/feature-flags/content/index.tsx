/**
 * Feature-flags learn-deck. Played in the run screen's left pane while
 * the agent layers a kill switch onto an existing PostHog install.
 *
 * Story, not a syllabus: named welcome, a /flags spike, a 0% boolean,
 * the page flipping on, then a closer you can quote. Set pieces live in
 * ./set-pieces.tsx. Pane is ~37 chars at 80 columns.
 *
 * Program-owned; wired onto featureFlagsConfig.getContentBlocks.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { WizardStore } from '@ui/tui/store';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import {
  isClearBlock,
  type ContentBlock,
} from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';
import {
  FLAG_SPIKE,
  FIRST_PAINT,
  INVOICE_CHEAP,
  PAGE_OFF,
  PAGE_ON,
  ROLLOUT_SLIDER,
} from './set-pieces.js';

/**
 * Per-slide dwell multiplier. Each block stays on screen for `pause * SLIDE_PACE`
 * ms after it finishes animating. Clear (page-break) blocks are left
 * untouched so the blank gap between slides stays snappy.
 */
const SLIDE_PACE = 1.5;

const withPace = (block: ContentBlock): ContentBlock => {
  if (typeof block === 'string' || isClearBlock(block) || block.pause == null) {
    return block;
  }
  return { ...block, pause: Math.round(block.pause * SLIDE_PACE) };
};

const pace = (blocks: ContentBlock[]): ContentBlock[] => blocks.map(withPace);

const CLEAR: ContentBlock = { type: 'clear', pause: 1500 };

export const getContentBlocks = (store?: WizardStore): ContentBlock[] =>
  pace([
    {
      content: store?.session.apiUser?.first_name
        ? `Welcome, ${store.session.apiUser.first_name}.`
        : 'Welcome.',
      pause: 3000,
      mode: TextRevealMode.Typewriter,
      animationInterval: 160,
    },

    { content: 'The Wizard is an agent.', pause: 4000 },

    {
      content: "I'm putting a kill switch on this app.",
      pause: 2800,
      dimWhenComplete: false,
    },

    {
      content: 'But...',
      pause: 1800,
      mode: TextRevealMode.Typewriter,
      animationInterval: 90,
      sentenceInterval: 400,
      dimWhenComplete: false,
    },

    {
      content: 'Nothing turns on until you say so.',
      pause: 5000,
    },

    {
      content:
        'I would make you a coffee, but I am a terminal, so that part is on you.',
      pause: 5500,
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
      content:
        'Flags are usually quiet, until CI wakes up and never goes back to sleep.',
      pause: 5500,
    },

    FLAG_SPIKE,

    {
      content: 'This request inflates the bill and every /flags call is on it.',
      pause: 6000,
    },

    CLEAR,

    {
      content:
        'So we call evaluateFlags once on the server, then bootstrap the client.',
      pause: 5500,
    },

    FIRST_PAINT,

    {
      content:
        'The Save button is already there at t=0, with no flicker and no second trip.',
      pause: 5500,
    },

    CLEAR,

    {
      content: 'The receipt, if you were wondering.',
      pause: 3500,
    },

    INVOICE_CHEAP,

    CLEAR,

    {
      content:
        'Confirm, and we create one boolean at 0%. Which is a polite way of saying nothing happens yet.',
      pause: 5500,
    },

    ROLLOUT_SLIDER,

    {
      content:
        'Need green vs blue later? That is multivariate, and we are absolutely not doing that today.',
      pause: 6500,
    },

    {
      content:
        'Skip is first, if you only wanted the wiring and none of the drama.',
      pause: 5000,
    },

    CLEAR,

    { content: 'Raise it, and the page gains one new thing.', pause: 4500 },

    PAGE_OFF,

    { content: 'Then this.', pause: 2000 },

    PAGE_ON,

    {
      content:
        'Set it back to 0%, and the banner is gone like it was never invited.',
      pause: 5500,
    },

    CLEAR,

    {
      content: 'Until you raise it, nobody sees a thing.',
      pause: 8000,
    },

    {
      pause: 90000,
      content: (
        <Text>
          Press{' '}
          <Text color={Colors.accent} bold>
            S
          </Text>{' '}
          to follow along. Or sit tight, I'll let you know when it's done.
        </Text>
      ),
    },
  ]);
