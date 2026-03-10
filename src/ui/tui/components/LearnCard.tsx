/**
 * LearnCard — PostHog educational content with animated text reveal.
 */

import { Box, Text } from 'ink';
import { useEffect, useMemo, useRef } from 'react';
import { Colors } from '../styles.js';
import type { WizardStore } from '../store.js';
import { ContentSequencer, TextRevealMode } from '../primitives/index.js';
import type { ContentBlock } from '../primitives/index.js';
import { useStdoutDimensions } from '../hooks/useStdoutDimensions.js';
import { COLLAPSED_COUNT, EXPANDED_COUNT } from '../primitives/TabContainer.js';

/**
 * StatusPeekTrigger — Fires the status bar expansion once, renders nothing.
 * The peek is guarded by peekedRef so re-mounts are safe.
 */
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
    // No cleanup — the store call is safe after unmount and the component
    // may be evicted before the timer fires (non-persist NodeBlock).
    setTimeout(() => {
      store?.setStatusExpanded(false);
    }, duration);
  }, [store, duration, peekedRef]);

  return <Text>You can view the Wizard&apos;s status below.</Text>;
};

const POSTHOG_DATA_FLOW: ContentBlock = {
  type: 'lines',
  interval: 500,
  pause: 8000,
  // Box is 30 chars wide between │ borders.
  // Labels: 1-char indent. Arrows: "   ↓ " (5). Sub-items: "   │   " (7).
  lines: [
    <Text color="gray">{'  ┌──────────────────────────────┐'}</Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color="cyan">
        Your App
      </Text>
      <Text color="gray">{'                     │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │ '}</Text>
      <Text>posthog.capture()</Text>
      <Text color="gray">{'        │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │  '}</Text>
      <Text dimColor>custom events</Text>
      <Text color="gray">{'           │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │  '}</Text>
      <Text dimColor>custom properties</Text>
      <Text color="gray">{'       │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   │  '}</Text>
      <Text dimColor>person profiles</Text>
      <Text color="gray">{'         │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   ↓  '}</Text>
      <Text dimColor>groups</Text>
      <Text color="gray">{'                  │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color={Colors.accent}>
        PostHog SDK
      </Text>
      <Text color="gray">{'                  │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   ↓ '}</Text>
      <Text>HTTP</Text>
      <Text color="gray">{'                     │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color={Colors.accent}>
        PostHog Cloud
      </Text>
      <Text color="gray">{'                │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │   ↓ '}</Text>
      <Text>query + visualize</Text>
      <Text color="gray">{'        │'}</Text>
    </Text>,
    <Text>
      <Text color="gray">{'  │ '}</Text>
      <Text bold color="green">
        Dashboards & Insights
      </Text>
      <Text color="gray">{'        │'}</Text>
    </Text>,
    <Text color="gray">{'  └──────────────────────────────┘'}</Text>,
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
    // 10k
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
    // 7.5k
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
    // 5k
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
    // 2.5k
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
    // 0
    <Text>
      <Text color="gray">{'    0 ┤'}</Text>
      <Text color="cyan">{'──────╯'}</Text>
    </Text>,
    // X-axis
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
    // Step 1
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
    // Step 2
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
    // Step 3
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
    // Step 4
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

interface LearnCardProps {
  store?: WizardStore;
  onComplete?: () => void;
}

export const LearnCard = ({ store, onComplete }: LearnCardProps) => {
  const peekedRef = useRef(false);
  const [columns, rows] = useStdoutDimensions();

  const blocks = useMemo<ContentBlock[]>(
    () => [
      {
        content: 'Welcome.',
        pause: 3000,
        mode: TextRevealMode.Typewriter,
        animationInterval: 160,
      },

      { content: 'The Wizard is an agent.', pause: 4000 },

      {
        content: 'It handles the entire PostHog setup process on your behalf.',
        pause: 5000,
      },

      {
        content:
          "As we speak, it's building a plan to set up PostHog in your project.",
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

      {
        content: 'It takes about eight minutes.',
        pause: 2000,
      },

      {
        content: 'So grab some coffee ☕️.',
        pause: 2000,
      },

      {
        content: 'Or stick around and learn about PostHog.',
        pause: 5000,
      },

      { type: 'clear', pause: 3000 },

      {
        content: 'Events are the foundation of the PostHog platform.',
        pause: 4000,
      },

      {
        content:
          'Every time an action is performed in your codebase — like button clicks, function calls, or thrown errors — we can capture an event.',
        pause: 6000,
      },

      {
        content:
          'Events are sent to PostHog and joined with other product data.',
        pause: 6000,
      },

      { type: 'clear', pause: 1000 },

      { content: "Here's the flow.", pause: 1000 },

      POSTHOG_DATA_FLOW,

      { type: 'clear', pause: 2000 },

      {
        content:
          'With enough event data, you can answer powerful questions about your product.',
        pause: 4000,
      },

      { content: 'And create insights.', pause: 4000 },

      { type: 'clear', pause: 500 },

      { content: 'Like trends to measure growth.', pause: 2500 },

      LINE_CHART_BLOCK,

      { type: 'clear', pause: 500 },

      { content: 'Or funnels to reveal bottlenecks.', pause: 2500 },

      FUNNEL_BLOCK,

      { type: 'clear', pause: 1000 },

      {
        content: 'Use those signals to decide what to build next.',
        pause: 4000,
      },

      { content: 'PostHog has all the dev tools you need.', pause: 3000 },

      PRODUCT_SUITE_BLOCK,
    ],
    [store],
  );

  // Dynamic status bar height: messages + border when present
  const hasStatus = store ? store.statusMessages.length > 0 : false;
  const statusBarRows = hasStatus
    ? (store?.statusExpanded ? EXPANDED_COUNT : COLLAPSED_COUNT) + 1
    : 0;

  const contentHeight = rows - FIXED_CHROME - statusBarRows;
  const tooSmall = contentHeight < MIN_CONTENT_ROWS;

  const maxHeight = Math.max(1, contentHeight - HEADER_ROWS);
  // Half of clamped content width, minus paddingX on both sides
  const paneWidth = Math.floor((Math.min(120, columns) - 2) / 2) - 2;

  // Always render so ContentSequencer stays mounted (preserves activeIdx).
  // When too small, hide visually via display="none".
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
