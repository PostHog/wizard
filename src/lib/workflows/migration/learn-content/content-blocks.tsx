/**
 * Learn-pane script for the migration workflow. Focuses on the multi-vendor
 * → PostHog consolidation: cost comparison, free-tier, pricing model, then
 * familiar analyses (trends + funnels) the team already had.
 */

import { Text } from 'ink';
import type { WizardStore } from '../../../../ui/tui/store.js';
import { Colors } from '../../../../ui/tui/styles.js';
import {
  TextRevealMode,
  type ContentBlock,
} from '../../../../ui/tui/primitives/index.js';
import { StatusPeekTrigger } from '../../../../ui/tui/components/StatusPeekTrigger.js';
import { VENDOR_STACK_BLOCK } from './vendor-stack.js';
import { FREE_TIER_BLOCK } from './free-tier.js';
import { PRICING_STRUCTURE_BLOCK } from './pricing-structure.js';
import { PRODUCT_SUITE_BLOCK } from './product-suite.js';
import { LINE_CHART_BLOCK } from './line-chart.js';
import { FUNNEL_BLOCK } from './funnel.js';
import { COMPETITOR_BLOCK } from './competitor.js';
import { DID_YOU_KNOW_BLOCK } from './did-you-know-block.js';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => [
  {
    content: 'Hello.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },

  { content: 'The Wizard is an agent.', pause: 4000 },

  {
    content: "As we speak, it's making a PostHog migration plan to...",
    pause: 6000,
  },

  { type: 'clear', pause: 2000 },

  {
    content: 'Destroy our competitors.',
    pause: 2000,
  },
  COMPETITOR_BLOCK,

  { type: 'clear', pause: 2000 },

  {
    content: 'Did you know?',
    pause: 3000,
  },
  ...DID_YOU_KNOW_BLOCK,

  { type: 'clear', pause: 2000 },

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

  { type: 'clear', pause: 2000 },

  { content: 'It takes about five minutes.', pause: 2000 },

  {
    content: 'So stick around — here’s what you’re moving onto.',
    pause: 4000,
  },

  { type: 'clear', pause: 1500 },

  {
    content: 'PostHog replaces multi-vendor stacks with one platform.',
    pause: 5000,
  },

  { content: 'Here’s the math.', pause: 1500 },

  VENDOR_STACK_BLOCK,

  { type: 'clear', pause: 1500 },

  { content: 'All the dev and AI tools you need in one place.', pause: 3000 },

  PRODUCT_SUITE_BLOCK,

  { type: 'clear', pause: 1500 },

  {
    content: 'Pricing is usage-based, with a generous free tier.',
    pause: 4000,
  },

  FREE_TIER_BLOCK,

  { type: 'clear', pause: 1500 },

  PRICING_STRUCTURE_BLOCK,

  { type: 'clear', pause: 1500 },

  { content: 'You still get every analysis you had before.', pause: 4000 },

  { content: 'Trends to measure growth.', pause: 2500 },

  LINE_CHART_BLOCK,

  { type: 'clear', pause: 500 },

  { content: 'Funnels to reveal bottlenecks.', pause: 2500 },

  FUNNEL_BLOCK,
];
