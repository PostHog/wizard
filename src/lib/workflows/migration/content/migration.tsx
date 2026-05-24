/**
 * Generic migration learn material. Plays for every `migrate` run regardless
 * of source product. The narrative focuses on multi-vendor consolidation:
 * cost comparison, free-tier breakdown, pricing model, then familiar analyses
 * (trends + funnels) the team already had.
 */

import { Text } from 'ink';
import type { WizardStore } from '../../../../ui/tui/store.js';
import { Colors } from '../../../../ui/tui/styles.js';
import { TextRevealMode } from '../../../../ui/tui/primitives/TextBlock.js';
import type { ContentBlock } from '../../../../ui/tui/primitives/content-types.js';
import { StatusPeekTrigger } from '../../../../ui/tui/components/StatusPeekTrigger.js';
import { VENDOR_STACK_BLOCK } from './vendor-stack.js';
import { FREE_TIER_BLOCK } from './free-tier.js';
import { PRICING_STRUCTURE_BLOCK } from './pricing-structure.js';
import { PRODUCT_SUITE_BLOCK } from './product-suite.js';
import { LINE_CHART_BLOCK } from './line-chart.js';
import { FUNNEL_BLOCK } from './funnel.js';

/**
 * Human-readable display name for each `--product=<id>` variant of the
 * `migrate` command. The intro line reads "migrate from <label> to PostHog"
 * when the variant is known, and "migrate this project to PostHog" otherwise.
 */
const PRODUCT_LABELS: Record<string, string> = {
  statsig: 'Statsig',
};

function migrationIntroPhrase(store?: WizardStore): string {
  const skillId = store?.session.skillId ?? '';
  const prefix = 'migrate-';
  if (!skillId.startsWith(prefix)) return 'migrate this project to PostHog';
  const variant = skillId.slice(prefix.length);
  const label = PRODUCT_LABELS[variant];
  return label
    ? `migrate from ${label} to PostHog`
    : 'migrate this project to PostHog';
}

export const getMigrationBlocks = (store?: WizardStore): ContentBlock[] => [
  {
    content: 'Hello.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },

  { content: 'The Wizard is an agent.', pause: 4000 },

  {
    content: `As we speak, it's making a plan to ${migrationIntroPhrase(
      store,
    )}.`,
    pause: 6000,
  },

  {
    content: 'PostHog covers the cost of running this agent.',
    pause: 4000,
  },

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
