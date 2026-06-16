/**
 * Migration learn deck (statsig variant). Statsig is the only `migrate`
 * variant today, so this deck plays as-is when the wizard runs
 * `migrate --product=statsig`. Three movements:
 *
 *   1. Welcome and reassure.
 *   2. What to expect — the migration is replacement-only, takes a few
 *      minutes, leaves the build green.
 *   3. What's a little different — how flags and experiments work in
 *      PostHog, presented as right-way guidance rather than gotchas.
 *
 * FF/experiments guidance paraphrased from PostHog public docs:
 *   - posthog.com/docs/feature-flags/best-practices
 *   - posthog.com/docs/feature-flags/common-questions
 *   - posthog.com/docs/experiments/best-practices
 */

import { Text } from 'ink';
import type { WizardStore } from '@ui/tui/store';
import { Colors } from '@ui/tui/styles';
import { TextRevealMode } from '@ui/tui/primitives/TextBlock';
import type { ContentBlock } from '@ui/tui/primitives/content-types';
import { StatusPeekTrigger } from '@ui/tui/components/StatusPeekTrigger';
import { PRODUCT_SUITE_BLOCK } from '@lib/programs/posthog-integration/content/product-suite';
import { LINE_CHART_BLOCK } from '@lib/programs/posthog-integration/content/line-chart';
import { FUNNEL_BLOCK } from '@lib/programs/posthog-integration/content/funnel';
import { VENDOR_STACK_BLOCK } from './vendor-stack.js';
import { FREE_TIER_BLOCK } from './free-tier.js';
import { PRICING_STRUCTURE_BLOCK } from './pricing-structure.js';

export const getContentBlocks = (store?: WizardStore): ContentBlock[] => [
  // ── Welcome ────────────────────────────────────────────────────────────
  {
    content: 'Hello.',
    pause: 3000,
    mode: TextRevealMode.Typewriter,
    animationInterval: 160,
  },

  { content: 'The Wizard is an agent.', pause: 4000 },

  {
    content:
      'As we speak, it’s making a plan to migrate from Statsig to PostHog.',
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
    persist: true,
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

  // ── What to expect ─────────────────────────────────────────────────────
  { content: 'Here’s what to expect.', pause: 3000 },

  { content: 'The migration takes about ten minutes.', pause: 3000 },

  {
    content:
      'Every Statsig call gets replaced in place with its PostHog equivalent.',
    pause: 5500,
  },

  {
    content:
      'Nothing new gets added. No extra captures, no surprise instrumentation.',
    pause: 5500,
  },

  {
    content:
      'The Statsig package gets removed at the end. We’ll run build and lint to clean up after ourselves.',
    pause: 6500,
  },

  { type: 'clear', pause: 2000 },

  // ── What's a little different ─────────────────────────────────────────
  {
    content: 'A few things work a little differently in PostHog.',
    pause: 4500,
  },

  {
    content: (
      <Text>
        Flags evaluate against a stable user. Call{' '}
        <Text bold color={Colors.accent}>
          identify()
        </Text>{' '}
        first, then check the flag.
      </Text>
    ),
    pause: 6000,
    persist: true,
  },

  {
    content:
      'For anything in the first paint, evaluate server-side and bootstrap the values into the client.',
    pause: 6500,
  },

  {
    content: (
      <Text>
        In production, route requests through a reverse proxy to avoid ad
        blockers breaking your flags.{'\n'}
        <Text dimColor>https://posthog.com/docs/advanced/proxy</Text>
      </Text>
    ),
    pause: 6500,
    persist: true,
  },

  {
    content:
      'When a flag reaches 100% rollout, retire it. Flags are signals, not switches.',
    pause: 5500,
  },

  {
    content: (
      <Text>
        Name flags descriptively. No double negatives. Reflect the return type.{' '}
        <Text dimColor>For example </Text>
        <Text bold>show-new-checkout</Text>
        <Text dimColor>.</Text>
      </Text>
    ),
    pause: 6500,
    persist: true,
  },

  { type: 'clear', pause: 1500 },

  // ── Experiments ────────────────────────────────────────────────────────
  {
    content: (
      <Text bold color={Colors.accent}>
        Experiments
      </Text>
    ),
    pause: 2500,
    persist: true,
  },

  {
    content:
      'Change one thing per variant. Multiple changes in one variant blur the result.',
    pause: 5500,
  },

  {
    content:
      'Decide the running time up front. PostHog includes a sample-size and duration calculator in the setup flow.',
    pause: 6500,
  },

  {
    content: 'Roll out to 5–10% first. Watch the metrics. Then increase.',
    pause: 5000,
  },

  {
    content:
      'Exclude users who already completed the flow. They can’t be affected by the test.',
    pause: 5500,
  },

  { type: 'clear', pause: 1500 },

  // ── Close ──────────────────────────────────────────────────────────────
  {
    content: 'Flags and experiments live alongside the rest of your data.',
    pause: 4500,
  },

  {
    content: 'Ship behind a flag, watch replays, check analytics for impact.',
    pause: 4500,
  },

  { type: 'clear', pause: 1500 },

  {
    content:
      'PostHog also provides every other dev and AI tool to build your product.',
    pause: 4500,
  },

  PRODUCT_SUITE_BLOCK,

  { type: 'clear', pause: 1500 },

  {
    content: 'And consolidating onto one platform saves real money.',
    pause: 4500,
  },

  { content: 'Here’s the math.', pause: 1500 },

  VENDOR_STACK_BLOCK,

  { type: 'clear', pause: 1500 },

  {
    content: 'Pricing is usage-based, with a generous free tier.',
    pause: 4000,
  },

  FREE_TIER_BLOCK,

  { type: 'clear', pause: 1500 },

  PRICING_STRUCTURE_BLOCK,

  { type: 'clear', pause: 1500 },

  {
    content: 'Gain clarity and really understand your users.',
    pause: 4000,
  },

  { content: 'Use trends to measure growth.', pause: 2500 },

  LINE_CHART_BLOCK,

  { type: 'clear', pause: 500 },

  { content: 'Use funnels to reveal bottlenecks.', pause: 2500 },

  FUNNEL_BLOCK,
];
