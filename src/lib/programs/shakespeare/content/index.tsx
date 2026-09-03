/**
 * Shakespeare learn-deck — portrait, then what the program does, then a
 * few lines it might drop into your code. Overrides the generic
 * agent-skill deck (`programs/agent-skill/content/index.tsx`) that
 * `createSkillProgram` wires up by default.
 */

import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import type { WizardStore } from '@ui/tui/store';
import { PORTRAIT_BLOCK } from './portrait.js';

const CLEAR: ContentBlock = { type: 'clear', pause: 1500 };

export const getContentBlocks = (_store?: WizardStore): ContentBlock[] => [
  // Scene 1 — portrait
  PORTRAIT_BLOCK,

  CLEAR,

  // Scene 2 — what this program actually does
  {
    content: 'This one is an internal test, not a PostHog feature.',
    pause: 4000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 24,
  },
  {
    content:
      'It installs a single context-mill skill with no SDK and no product logic.',
    pause: 5000,
  },
  {
    content:
      "Just one line of Shakespeare, dropped into your project's most prominent file.",
    pause: 5000,
  },
  {
    content: "It's here to test the skill-to-wizard-program pipeline end to end.",
    pause: 5000,
  },

  CLEAR,

  // Scene 3 — a few lines it might choose from
  { content: 'A few of the lines it might pick:', pause: 2500 },

  {
    content: '"All the world\'s a stage, and all the men and women merely players."',
    pause: 5000,
    mode: TextRevealMode.SentenceFade,
  },

  {
    content: '"To be, or not to be, that is the question."',
    pause: 5000,
    mode: TextRevealMode.SentenceFade,
  },

  {
    content: '"We know what we are, but know not what we may be."',
    pause: 5000,
    mode: TextRevealMode.SentenceFade,
  },
];
