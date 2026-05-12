/**
 * MigrationLearnCard — Slideshow shown during the migration flow.
 *
 * Sibling to LearnCard. Self-contained: holds its own block defs and
 * rendering shell so the migration narrative can evolve independently
 * of the integration deck. Free-tier numbers come from posthog.com/pricing.md.
 */

import { Box, Text } from 'ink';
import { useEffect, useMemo, useRef } from 'react';
import { Colors } from '../styles.js';
import type { WizardStore } from '../store.js';
import { ContentSequencer, TextRevealMode } from '../primitives/index.js';
import type { ContentBlock } from '../primitives/index.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { COLLAPSED_COUNT, EXPANDED_COUNT } from '../primitives/TabContainer.js';

const StatusPeekTrigger = ({
  store,
  duration = 10000,
  peekedRef,
}: {
  store?: WizardStore;
  duration?: number;
  peekedRef: ReturnType<typeof useRef<boolean>>;
}) => {
  useEffect(() => {
    if (peekedRef.current) return;
    peekedRef.current = true;
    store?.setStatusExpanded(true);
    setTimeout(() => {
      store?.setStatusExpanded(false);
    }, duration);
  }, [store, duration, peekedRef]);

  return <Text>You can view the Wizard&apos;s status below.</Text>;
};

/**
 * Vendor cost stack — the multi-tool baseline a typical migration target has
 * before consolidating onto PostHog. Numbers from each vendor's published
 * starter pricing.
 */
const VENDOR_STACK_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 600,
  pause: 9000,
  lines: [
    <Text bold>{'  Typical pre-migration stack'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color="gray">{'  Sentry'}</Text>
      <Text>{'         error tracking      '}</Text>
      <Text color="red">{'$26/mo+'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  LaunchDarkly'}</Text>
      <Text>{'   feature flags       '}</Text>
      <Text color="red">{'$8.33/mo+'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  Amplitude'}</Text>
      <Text>{'      product analytics   '}</Text>
      <Text color="red">{'$49/mo+'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  Braintrust'}</Text>
      <Text>{'     LLM analytics       '}</Text>
      <Text color="red">{'$50/mo+'}</Text>
    </Text>,
    <Text color="gray">{'  ─────────────────────────────────────'}</Text>,
    <Text>
      <Text>{'  Total'}</Text>
      <Text>{'                              '}</Text>
      <Text bold color="red">
        {'$133/mo+'}
      </Text>
    </Text>,
    <Text dimColor>{'  plus ~450KB of JavaScript SDKs'}</Text>,
  ],
};

/**
 * PostHog free-tier highlights — the numbers a migrating team gets back when
 * they consolidate. Sourced from posthog.com/pricing.md.
 */
const FREE_TIER_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 400,
  pause: 9000,
  lines: [
    <Text bold>{'  Free every month, on every product'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color={Colors.accent}>{'  1,000,000  '}</Text>
      <Text>events </Text>
      <Text dimColor>product analytics</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  1,000,000  '}</Text>
      <Text>requests </Text>
      <Text dimColor>feature flags + experiments</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'      5,000  '}</Text>
      <Text>recordings </Text>
      <Text dimColor>session replay</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'    100,000  '}</Text>
      <Text>exceptions </Text>
      <Text dimColor>error tracking</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'    100,000  '}</Text>
      <Text>events </Text>
      <Text dimColor>LLM analytics</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'      50 GB  '}</Text>
      <Text>logs </Text>
      <Text dimColor>logs</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'      1,500  '}</Text>
      <Text>responses </Text>
      <Text dimColor>surveys</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  1,000,000  '}</Text>
      <Text>rows </Text>
      <Text dimColor>data warehouse</Text>
    </Text>,
  ],
};

/**
 * Pricing structure block — what happens after the free tier.
 */
const PRICING_STRUCTURE_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
  lines: [
    <Text bold>{'  After the free tier'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color={Colors.accent}>{'  $0 '}</Text>
      <Text>base price · pay only for what you use</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>per-event prices decrease with volume</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>no per-seat charges — your whole team is included</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>web analytics bundled with product analytics</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>experiments bundled with feature flags</Text>
    </Text>,
    <Text>
      <Text color={Colors.accent}>{'  ◆ '}</Text>
      <Text>revenue analytics bundled with data warehouse</Text>
    </Text>,
  ],
};

const PRODUCT_SUITE_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 1000,
  pause: 15000,
  lines: [
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Product Analytics     '}
      <Text color="cyan">{'◆ '}</Text>
      {'Error Tracking'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Web Analytics         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Session Replay'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Feature Flags         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Data Pipelines'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Experiments           '}
      <Text color="cyan">{'◆ '}</Text>
      {'Data Warehouse'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'LLM Analytics         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Surveys'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Workflows             '}
      <Text color="cyan">{'◆ '}</Text>
      {'Logs'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Product Tours         '}
      <Text color="cyan">{'◆ '}</Text>
      {'Support'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Revenue Analytics     '}
      <Text color="cyan">{'◆ '}</Text>
      {'Endpoints'}
    </Text>,
    <Text>
      <Text color="cyan">{'  ◆ '}</Text>
      {'Customer Analytics'}
    </Text>,
  ],
};

const LINE_CHART_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 300,
  pause: 6000,
  lines: [
    <Text bold>{'  Trends · user signups (monthly)'}</Text>,
    <Text> </Text>,
    <Text>
      <Text color="gray">{'  10k ┤'}</Text>
      {'                          '}
      <Text color="cyan">{'╭──'}</Text>
      <Text dimColor>{' 9,575'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'                         '}
      <Text color="cyan">{'╭╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{' 7.5k ┤'}</Text>
      {'                        '}
      <Text color="cyan">{'╭╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'                      '}
      <Text color="cyan">{'╭─╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'   5k ┤'}</Text>
      {'                    '}
      <Text color="cyan">{'╭─╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'                 '}
      <Text color="cyan">{'╭──╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{' 2.5k ┤'}</Text>
      {'             '}
      <Text color="cyan">{'╭───╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'      │'}</Text>
      {'      '}
      <Text color="cyan">{'╭──────╯'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'    0 ┤'}</Text>
      <Text color="cyan">{'──────╯'}</Text>
    </Text>,
    <Text color="gray">{'      └┬─────┬─────┬─────┬─────┬──'}</Text>,
    <Text dimColor>{'       May   Aug   Nov   Feb   May'}</Text>,
  ],
};

const FUNNEL_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 200,
  pause: 8000,
  lines: [
    <Text bold>{'  Funnel · ride conversion'}</Text>,
    <Text> </Text>,
    <Text>
      {'  '}
      <Text bold>1</Text>
      {'  app_launched'}
      {'                     '}
      <Text bold color="green">
        100.00%
      </Text>
    </Text>,
    <Text color="cyan">{'     ██████████████████████████████'}</Text>,
    <Text dimColor>{'     → 1,200 users'}</Text>,
    <Text> </Text>,
    <Text>
      {'  '}
      <Text bold>2</Text>
      {'  ride_requested'}
      {'       '}
      <Text dimColor>{'avg 2m 30s'}</Text>
      {'   '}
      <Text bold color="green">
        72.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'██████████████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 864 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 336 (28%)'}</Text>
    </Text>,
    <Text> </Text>,
    <Text>
      {'  '}
      <Text bold>3</Text>
      {'  ride_accepted'}
      {'        '}
      <Text dimColor>{'avg 5m 12s'}</Text>
      {'   '}
      <Text bold color="green">
        51.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'██████████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 612 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 252 (29%)'}</Text>
    </Text>,
    <Text> </Text>,
    <Text>
      {'  '}
      <Text bold>4</Text>
      {'  ride_started'}
      {'         '}
      <Text dimColor>{'avg 1m 45s'}</Text>
      {'   '}
      <Text bold color="green">
        38.00%
      </Text>
    </Text>,
    <Text>
      {'     '}
      <Text color="cyan">{'█████████████'}</Text>
      <Text dimColor>{'░░░░░░░░░░░░░░░░░░'}</Text>
    </Text>,
    <Text>
      {'     '}
      <Text dimColor>→ 456 users</Text>
      {'  '}
      <Text color="red">↘</Text>
      <Text dimColor>{' 156 (25%)'}</Text>
    </Text>,
  ],
};

/** Fixed chrome: ScreenContainer (3) + TabContainer tab bar (2) */
const FIXED_CHROME = 5;
const HEADER_ROWS = 2; // title + spacer
const MIN_CONTENT_ROWS = 6;

interface MigrationLearnCardProps {
  store?: WizardStore;
  onComplete?: () => void;
}

export const MigrationLearnCard = ({
  store,
  onComplete,
}: MigrationLearnCardProps) => {
  const peekedRef = useRef(false);
  const [columns, rows] = useStdoutDimensions();

  const blocks = useMemo<ContentBlock[]>(
    () => [
      {
        content: 'Migrating to PostHog.',
        pause: 3000,
        mode: TextRevealMode.Typewriter,
        animationInterval: 160,
      },

      { content: 'The Wizard is an agent.', pause: 4000 },

      {
        content:
          'It moves your existing analytics, flag, and observability calls onto PostHog while you watch.',
        pause: 6000,
      },

      { type: 'clear', pause: 2000 },

      {
        pause: 5000,
        persist: true,
        content: <StatusPeekTrigger store={store} peekedRef={peekedRef} />,
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
        content:
          'PostHog replaces multi-vendor stacks with one SDK and one dashboard.',
        pause: 5000,
      },

      { content: 'Here’s the math.', pause: 1500 },

      VENDOR_STACK_BLOCK,

      { type: 'clear', pause: 1500 },

      { content: 'Same data, fewer vendors.', pause: 3000 },

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
    ],
    [store],
  );

  const hasStatus = store ? store.statusMessages.length > 0 : false;
  const statusBarRows = hasStatus
    ? (store?.statusExpanded ? EXPANDED_COUNT : COLLAPSED_COUNT) + 1
    : 0;

  const contentHeight = rows - FIXED_CHROME - statusBarRows;
  const tooSmall = contentHeight < MIN_CONTENT_ROWS;

  const maxHeight = Math.max(1, contentHeight - HEADER_ROWS);
  const paneWidth = Math.floor((Math.min(120, columns) - 2) / 2) - 2;

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      display={tooSmall ? 'none' : 'flex'}
    >
      <Text bold color={Colors.accent}>
        Learn
      </Text>
      <Box height={1} />
      <ContentSequencer
        blocks={blocks}
        mode={TextRevealMode.SentenceBySentence}
        maxHeight={maxHeight}
        availableWidth={paneWidth}
        startDelay={2000}
        initialBlockIdx={store?.learnCardBlockIdx ?? 0}
        onBlockChange={(idx) => store?.setLearnCardBlockIdx(idx)}
        onSequenceComplete={onComplete}
      />
    </Box>
  );
};
